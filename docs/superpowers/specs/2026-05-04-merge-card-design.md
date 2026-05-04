# MergeCard — design

A non-agent canvas card that joins multiple inbound edges into a single composed downstream message. Replaces the `{{nodes.X.output}}` picker UX for multi-input aggregation with an explicit graph node.

## Goals

- Make fan-in / aggregation a first-class graph primitive instead of an edge-template trick.
- Restore the per-edge contract picker to its intuitive "this edge's source only" mental model.
- Keep timing semantics predictable: nothing emits downstream until every named input has arrived.

## Non-goals

- No `wait_mode = any` (emit on every delivery). Single mode: wait-for-all.
- No per-slot timeouts. One timeout per card.
- No conditional template syntax (`{{#if}}` etc.). The template renders once, all slots required.
- No auto-reset after timeout. Manual reset only — preserves "what arrived, what didn't" for inspection.
- No removal of Phase E's `{{nodes.X.output}}` syntax from the language. It stays for back-compat and edge-cases; only the **picker UI** stops surfacing it.
- No use of MergeCard's `{{slot.X}}` syntax outside the card's own template (edges keep `{{output}}` / `{{output.field}}` / `{{nodes.X.output}}`).

## Concept

```
Optimist ─[edge contract: transform={{output.points}}]─┐
                                                       ├→ MergeCard ─→ Editor
Pessimist ─[edge contract: transform={{output.points}}]┘
              "Pros: {{slot.Optimist}}\nCons: {{slot.Pessimist}}"
```

Each inbound edge keeps its existing contract (condition, schema, transform, gate). The edge transform shapes the *single* upstream's contribution before it lands in a slot. The MergeCard's own template composes the slots into one downstream message.

## Data model

```python
# backend/agents/models.py — new file: backend/agents/merge_models.py would also work,
# but follow the existing pattern (gate cards live in agents/models.py).

class MergeCard(BaseModel):
    id: str
    dashboard_id: str
    name: str
    template: str                                  # uses {{slot.<Name>[.path]}}
    timeout_seconds: int = 60                      # 0 = wait forever
    slots: dict[str, str] = {}                     # name.lower() → latest received text per round
    expected_slots: list[str] = []                 # snapshot of required slot keys for the current round; cleared on emission/reset
    status: Literal['idle','waiting','completed','error'] = 'idle'
    error_text: str | None = None
    last_emitted_at: datetime | None = None
    last_emitted_text: str | None = None           # surface in inspector / card preview
```

Storage: `~/.local/share/agentcanvas/merge_cards/{id}.json` (mirrors `gate_cards/`).

## Backend behavior

### Routing into a MergeCard

In `backend/agents/agent_manager.py:route_to_downstream`, when a connection's `to_card_id` resolves to a MergeCard:

1. Resolve source's display name via `_get_target_name`.
2. `key = name.lower()`. Write `routed_text` into `card.slots[key]` (latest-wins on duplicates).
3. If `card.expected_slots` is empty (start of round), snapshot it now: `card.expected_slots = sorted({lower(_get_target_name(c.from_card_id)) for c in inbound_connections_to(card.id) if _get_target_name(c.from_card_id)})`. Skip nameless cards. The snapshot locks the round against mid-flight topology changes.
4. If `set(card.slots) >= set(card.expected_slots)`:
   - Render `card.template` via `_apply_transform_for_merge(template, slots)` (new helper, mirrors `_apply_transform`'s structure).
   - `route_to_downstream(card.id, rendered, dashboard_id, ...)` — recurses through the merge card as a normal upstream.
   - Set `status='completed'`, `last_emitted_at=now`, `last_emitted_text=rendered`. Clear `slots` and `expected_slots`. Cancel any pending timer. Broadcast `merge_card:update`.
5. Else:
   - `status='waiting'`. Persist. Broadcast `merge_card:update`.
   - If no timer is running for this card and `timeout_seconds > 0`: schedule `asyncio.create_task(_merge_timeout(card.id, timeout_seconds))`.

### Timeout handler

```python
async def _merge_timeout(card_id: str, after_s: int) -> None:
    await asyncio.sleep(after_s)
    card = merge_manager.get(card_id)
    if not card or card.status != 'waiting':
        return  # already emitted or reset
    missing = sorted(set(card.expected_slots) - set(card.slots))
    card.status = 'error'
    card.error_text = f"Timeout after {after_s}s — missing: {', '.join(missing) or '(none)'}"
    save_merge_card(card)
    await ws_manager.broadcast_dashboard("merge_card:update", {"card_id": card_id, "card": card.model_dump()})
```

Timer task is tracked in a module-level `_pending_timeouts: dict[str, asyncio.Task]` so successful emission can `cancel()` it.

### Manual reset

`POST /api/merge-cards/{id}/reset`:
- Cancel pending timer if any.
- `card.slots = {}`; `card.expected_slots = []`; `card.status = 'idle'`; `card.error_text = None`.
- Save + broadcast.

### Template rendering — `_apply_transform_for_merge`

Same regex skeleton as `_apply_transform`, but only the `slot.` namespace:

```
{{slot.<Name>}}            → slots[name.lower()] full text
{{slot.<Name>.field}}      → JSON dot-path into slots[name.lower()]
```

Failure modes (unknown slot, missing field, non-JSON output) leave the placeholder intact — same convention as Phase E.

Implementation note: factor out the shared `_lookup_path` helper from `_apply_transform` so both renderers reuse it. Don't duplicate the JSON walking.

### Recursion / cycle safety

`route_to_downstream`'s existing `visited` set + depth-10 cap already protects against cycles when MergeCard re-enters routing.

### Connection clearing

When upstream agents are reset (e.g. via `clear_downstream`), MergeCards downstream should also have their `slots` cleared and `status` reverted to `idle`. Add a branch to `clear_downstream` mirroring the existing gate/dialogue clear logic.

## REST API

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/merge-cards` | `{dashboard_id, name, template, timeout_seconds?}` | full card |
| GET | `/api/merge-cards/{id}` | — | full card |
| PATCH | `/api/merge-cards/{id}` | partial: `{name?, template?, timeout_seconds?}` | full card |
| DELETE | `/api/merge-cards/{id}` | — | `{ok: true}` |
| POST | `/api/merge-cards/{id}/reset` | — | full card |

Filter MergeCards by dashboard via the existing dashboard load (they're persisted alongside other card types).

## WebSocket events

| Event | Direction | Payload |
|---|---|---|
| `merge_card:update` | server → client | `{card_id, card}` |

Mirrors `gate_card:update`. Frontend `mergeCardsSlice` reducer handles it the same way `gateCardsSlice` does.

## Frontend

### Files

- Create: `frontend/src/app/pages/Canvas/MergeCardComponent.tsx` — node body, mirrors `GateCardComponent.tsx`.
- Create: `frontend/src/shared/state/mergeCardsSlice.ts` — Redux slice mirroring `gateCardsSlice.ts`.
- Modify: `frontend/src/app/pages/Canvas/xyflow/nodes.tsx` — register `merge` node type.
- Modify: `frontend/src/app/pages/Canvas/Toolbar.tsx` — add `+ Merge Card` button next to `+ Gate Card`.
- Modify: `frontend/src/shared/state/store.ts` — wire the new slice.
- Modify: `frontend/src/shared/ws/WebSocketManager.ts` — dispatch `merge_card:update`.
- Modify: `frontend/src/app/pages/Canvas/Canvas.tsx` — drop the upstream sibling list from `upstreamNodes`; the picker now shows immediate upstream only.
- Modify: `frontend/src/app/pages/Canvas/upstreamPicker.tsx` — remove the dropdown UI; the picker becomes "Insert from this edge's source" with the `output` chip + JSON path chips.

### Card UI

**Collapsed** (default 200×80):
```
┌─────────────────────────────────┐
│ ● <Name>     [merge] [N/M]      │  ← status dot + slot fill ratio
└─────────────────────────────────┘
```

**Expanded** (default 320×360, double-click to expand):
```
┌─────────────────────────────────┐
│ ● <Name>           [edit] [×]   │
│─────────────────────────────────│
│ Inbound slots:                  │
│   ✓ Optimist  "Faster delivery…"│
│   · Pessimist (waiting)         │
│─────────────────────────────────│
│ Template:                       │
│   Pros: {{slot.Optimist}}       │
│   Cons: {{slot.Pessimist}}      │
│─────────────────────────────────│
│ Last emission:                  │
│   <preview of last_emitted_text>│
│─────────────────────────────────│
│ [Reset]   (visible if status=error) │
└─────────────────────────────────┘
```

Status colors via shared `STATUS_COLORS`:
- `idle` → grey
- `waiting` → cyan (running-equivalent)
- `completed` → green
- `error` → red, with `error_text` shown above the Reset button

### Edit dialog

Reuse the same modal pattern as `GateCardComponent.tsx`:
- Name (text)
- Template (textarea, monospace)
- Timeout seconds (number, 0 = wait forever, default 60)
- Save / Cancel

Slot list is read-only on the card body (computed live from incoming events).

### Edge picker simplification

In `upstreamPicker.tsx`:
- Remove the `<select>` dropdown of upstream nodes.
- Show a static label "Insert from <ImmediateUpstreamName>:" once the picker has resolved which connection is being edited.
- Show `output` chip + dot-path chips derived from the immediate upstream's `last-run.response_out`. No more sibling-upstreams.
- Component signature changes from `upstream: UpstreamNode[]` to `upstream: UpstreamNode | null`.
- The `isImmediate` flag is gone (always immediate now).
- Snippet always uses the short `{{output}}` / `{{output.path}}` form.

In `Canvas.tsx`:
- `upstreamNodes` becomes `immediateUpstream` — single value computed from `connections.find(c => c.id === editingConn.connId)?.from`.
- Remove the `useSelector(s => s.agents.sessions)` for sibling lookup; only need the immediate upstream's name.

The `{{nodes.<Name>.output}}` syntax stays runnable (back-compat) but is no longer surfaced in the picker. Document this in the workflows doc.

## Naming collision

If two upstreams of a MergeCard share a lowercased display name, only the first one (by inbound-connection order) gets a slot; the second is logged with a warning and dropped from `expected_slots` (so it never blocks emission). This matches the Phase E precedent. The card's edit UI surfaces a warning banner if a collision is detected at save-time.

## Migration / back-compat

- No existing data is touched. MergeCards are a new card type with their own storage dir.
- Existing dashboards continue to work; the only visible change for users not using MergeCards is that the per-edge picker no longer shows a sibling dropdown.
- Existing transforms using `{{nodes.X.output}}` keep working server-side; users who relied on that pattern can either keep their hand-written templates or refactor into a MergeCard.
- Document the change in `docs/workflows.md`: deprecate the picker's multi-upstream surface, point users to MergeCard for fan-in.

## Risks

- **Inbound-edge enumeration must be stable** across the round. If a user adds a new inbound edge while a MergeCard is `waiting`, the `expected` set grows mid-round — the new edge has no slot, the card never completes. Mitigation: snapshot `expected` into the card itself (`card.expected_slots: list[str]`) when the first input arrives in a round; clear it on emission/reset. Locks the round to whatever inbound topology existed at trigger time.
- **Deadlock on errored upstream**: if Optimist hits `error` status, no slot is filled, MergeCard times out, no emission. This is by design. Document that resetting the failed agent + the MergeCard is the recovery path.
- **Timer leakage**: the `_pending_timeouts` dict must be cleaned up on app shutdown and on dashboard delete. Tasks are bound to the running event loop so process exit is fine; dashboard-delete needs an explicit cancel.
- **WebSocket event ordering**: if `merge_card:update` arrives at the client before the upstream `agent:status` for the contributing agent, slot UI may briefly show populated for an agent still marked running. Acceptable — eventually consistent.

## Build sequence (rough)

1. Backend models + storage + manager (mirrors gate_manager).
2. REST routes + WebSocket event.
3. Routing integration in `route_to_downstream` + timeout handler + clear_downstream branch.
4. Frontend slice + node component + Toolbar button.
5. Edge picker simplification (drop sibling list).
6. Docs update in `workflows.md`.
7. Manual smoke: Optimist + Pessimist → MergeCard → Editor, with a JSON-pluck on each inbound edge and `{{slot.X}}` composition on the card.

Implementation plan to follow.
