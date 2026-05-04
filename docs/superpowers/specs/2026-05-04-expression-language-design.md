# Phase E — Expression Language Polish

Design for the Phase E work in `docs/xyflow-migration.md` §2.6: extend the per-edge transform language to reference upstream nodes by name, surface autocomplete in the connection edit modal, and document the grammar.

## Goals

- Make multi-input transforms possible: an aggregator card should be able to pull fields from two different upstream agents in one template.
- Make the existing `{{output}}` / `{{output.field}}` syntax discoverable so users find it without reading source.
- Stay backwards-compatible. No migration of existing `transform` strings.

## Non-goals

- No `$now`, `$workflow`, jsonpath, or JS sandbox (the n8n-tarpit the plan calls out in §2.9).
- No transitive upstream walking — direct inbound edges only.
- No use in `system_prompt` or dialogue `initial_message`. Edge transforms only.
- No new persistence. Reuses Phase B `/api/sessions/{id}/last-run`.

## Grammar

```
{{output}}                       # full text of immediate upstream (unchanged)
{{output.<path>}}                # dot-path into JSON of immediate upstream (unchanged)
{{nodes.<Name>.output}}          # NEW — full text of named direct-upstream node
{{nodes.<Name>.output.<path>}}   # NEW — dot-path into named upstream's JSON output
```

- `<Name>` matches `Connection`-target names case-insensitively, same rule as `{{route:Name}}`.
- `<path>` is a dot-separated key chain into the JSON-decoded last assistant message of that node. Same parser as today's `{{output.<path>}}`.
- If a placeholder fails to resolve (unknown node, missing field, non-JSON output), it is left intact (matches current `{{output.field}}` behavior).
- Name collision: log a warning, use the first match. The UI prevents this by listing real node names; collisions only occur if a workflow file is hand-edited.

## Backend changes

### `agent_manager.py`

**`_apply_transform`** gains an optional `nodes` parameter:

```python
@staticmethod
def _apply_transform(transform: str, text: str, nodes: dict[str, str] | None = None) -> str:
```

Pattern: `\{\{(output(?:\.[\w.]+)?|nodes\.[^}]+)\}\}`. The substitution branches:
- `output` / `output.<path>` — unchanged, uses `text`.
- `nodes.<Name>` / `nodes.<Name>.output` / `nodes.<Name>.output.<path>` — looks up `nodes[name_lower]`, returns the text or a JSON dot-path lookup against it.

`<Name>` may contain spaces and most punctuation but not `}`. Trim surrounding whitespace.

### `route_to_downstream` (in `agent_manager.py`)

Before the per-connection loop (around line 210), build the upstream-by-name map:

```python
# All edges that terminate at any of this run's targets — caller already has `outgoing`
target_ids = {c.to_card_id for c in outgoing}
inbound = [c for c in connections if c.to_card_id in target_ids]
nodes_map: dict[str, str] = {}
for c in inbound:
    name = _get_target_name_for_source(c.from_card_id)  # mirror of existing _get_target_name
    if not name:
        continue
    last_text = _last_assistant_text(c.from_card_id, agent_mgr)
    if last_text is None:
        continue
    nodes_map[name.lower()] = last_text
```

Pass `nodes_map` into `_apply_transform`. The immediate upstream's `name` will also appear in the map; that's fine — `{{output}}` and `{{nodes.<self>.output}}` resolve to identical text.

`_last_assistant_text` is a new helper that pulls the last assistant message for an agent session. Gate/dialogue/view/input cards return `None` for now (their "output" semantics aren't a single assistant message and surfacing them is outside this phase).

### Models

No schema change. `Connection.transform` stays a `str`.

## Frontend changes

### Contract editor modal (`Canvas.tsx:239+`)

Add an "Insert from upstream" strip immediately above the existing transform textarea:

```
[Insert from upstream:  [▼ Pick node]  [path1] [path2] [path3] ...]
[ Transform template ]
[ <textarea>          ]
```

**Dropdown contents:** reachable direct-upstream nodes for the connection being edited. Computed from the in-memory `connections` selector:

```ts
const upstreamNodes = useMemo(() => {
  const targetId = editingConn?.to
  if (!targetId) return []
  const inbound = connections.filter(c => c.to_card_id === targetId)
  return inbound
    .map(c => ({ id: c.from_card_id, name: lookupCardName(c.from_card_id) }))
    .filter(n => n.name)
}, [connections, editingConn?.to])
```

**On node select:** fetch `/api/sessions/{id}/last-run`. Use `response_out` as the JSON source. Walk the parsed JSON and emit a flat list of dot-paths up to depth 3 (capped to 20 paths to keep the UI sane).

```ts
function discoverPaths(json: unknown, prefix = '', depth = 0): string[] {
  if (depth > 3 || json === null || typeof json !== 'object') return []
  return Object.entries(json).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k
    return [path, ...discoverPaths(v, path, depth + 1)]
  })
}
```

**On path click:** insert `{{nodes.<Name>.output.<path>}}` at the textarea cursor. If the chosen node is the immediate upstream (`editingConn.from === node.id`), insert the shorter `{{output.<path>}}` form instead.

If the upstream has no JSON output (or `last-run` returns 404), show a single `{{nodes.<Name>.output}}` row that inserts the full-text form.

**Failure modes:**
- `last-run` 404 (node has no completed run yet): dropdown still works; only the full-text row is shown.
- Network error: surface a small "Couldn't load output preview" hint, leave the dropdown usable.

### No other frontend touchpoints

The transform string is sent unchanged to the backend; no client-side validation or transformation.

## Docs

In `docs/workflows.md`, expand the existing "Transform" row in the contract table (~line 162) into a new subsection with:

1. Full grammar block (same as the **Grammar** section above).
2. Three worked examples:
   - Single-upstream JSON pluck: `Summary: {{output.summary}}`.
   - Multi-upstream aggregator: `Pros from {{nodes.Optimist.output.points}}\nCons from {{nodes.Pessimist.output.points}}`.
   - Forwarding raw text from a non-JSON upstream: `{{nodes.Researcher.output}}`.
3. A note that name lookup is case-insensitive and that collisions warn-and-pick-first.

Cross-reference the new subsection from `docs/data-models.md:73` (the `transform` row) and from `docs/api-reference.md` if connection-editing is documented there.

## Build sequence

1. Backend: extend `_apply_transform` signature + tests for the new placeholders.
2. Backend: build `nodes_map` in `route_to_downstream` and pass through.
3. Frontend: add the upstream picker UI to the contract modal.
4. Docs: workflows.md update.
5. Manual smoke test: two agents converging on a third with `{{nodes.A.output.x}} | {{nodes.B.output.y}}`.

## Risks

- **Name resolution drift** between backend (uses live session/gate/dialogue names) and frontend (uses card-position metadata). The dropdown lists what the *frontend* knows; the backend resolves what the *backend* knows. Mitigation: the dropdown is hint-only — backend is authoritative — and a missing match leaves the placeholder intact rather than corrupting the prompt.
- **`last-run` for non-agent upstreams**: gate/dialogue/view nodes don't have a clean `response_out`. Mitigation above: `_last_assistant_text` returns `None`, the placeholder leaves itself intact, and the UI still offers the full-text form (which routes the upstream's content unchanged via the existing `routed_content` path — same as today).
- **Token bloat in the inbound walk**: pulling every direct-upstream's last text into memory per route is fine at current scale (handful of edges per node). If it grows, lazy-resolve per placeholder.
