# Expression Language Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the per-edge transform language with `{{nodes.<Name>.output[.path]}}` referencing direct-upstream agents by name, and add an upstream picker to the connection contract modal so users can discover the syntax.

**Architecture:** Backend extends `_apply_transform(transform, text)` with an optional `nodes` dict keyed by lowercased node name; `route_to_downstream` builds that dict from the inbound-edge set of each connection's target. Frontend's contract modal gains an "Insert from upstream" strip that fetches `/api/sessions/{id}/last-run`, discovers JSON dot-paths, and inserts `{{nodes.<Name>.output[.path]}}` (or the shorter `{{output.path}}` form when the chosen node is the immediate upstream) at the textarea cursor.

**Tech Stack:** Python 3 (FastAPI/Pydantic backend), React 19 + TypeScript + Redux Toolkit + Vite frontend. No test framework is configured in the repo today; verification uses a one-off Python script and manual UI smoke.

**Spec:** `docs/superpowers/specs/2026-05-04-expression-language-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/agents/agent_manager.py` | Modify | `_apply_transform` gains `nodes` param + `nodes.<Name>.output[.path]` regex branch; `route_to_downstream` builds `nodes_map` and passes it through. New `_last_assistant_text` helper. |
| `backend/agents/models.py` | Modify | Update the inline doc-comment on `Connection.transform` to mention the new syntax. |
| `scripts/verify_expression_language.py` | Create | Standalone script exercising `_apply_transform` for every grammar branch (back-compat + new). Run with `python -m scripts.verify_expression_language`. |
| `frontend/src/app/pages/Canvas/Canvas.tsx` | Modify | Compute `upstreamNodes` for the editing connection, render the picker strip above the transform textarea, wire textarea ref + cursor-aware insert. |
| `frontend/src/app/pages/Canvas/upstreamPicker.tsx` | Create | The picker strip component: dropdown of upstream node names → fetch last-run → flat path list → `onInsert` callback. |
| `docs/workflows.md` | Modify | New "Transform expressions" subsection with grammar + 3 examples. |
| `docs/data-models.md` | Modify | Update the `transform` row to point at the new docs subsection. |

---

## Task 1: Backend — extend `_apply_transform` to support `{{nodes.<Name>.output[.path]}}`

**Files:**
- Modify: `backend/agents/agent_manager.py:927-952`

- [ ] **Step 1: Replace `_apply_transform` with the extended version**

In `backend/agents/agent_manager.py`, replace the method at lines 927-952 with:

```python
    @staticmethod
    def _apply_transform(
        transform: str,
        text: str,
        nodes: dict[str, str] | None = None,
    ) -> str:
        """Apply a transform template to output text.

        Supported placeholders:
        - {{output}} — full text of the immediate upstream
        - {{output.field}} — JSON dot-path into the immediate upstream's parsed output
        - {{nodes.<Name>.output}} — full text of a direct-upstream node, looked up by case-insensitive name
        - {{nodes.<Name>.output.field}} — JSON dot-path into that node's parsed output

        If a placeholder fails to resolve (unknown node, missing field, non-JSON output),
        the placeholder is left intact in the rendered string.
        """
        nodes = nodes or {}
        own_parsed = AgentManager._extract_json(text)

        def _lookup_path(parsed: object, path_parts: list[str]) -> str | None:
            val: object = parsed
            for key in path_parts:
                if isinstance(val, dict) and key in val:
                    val = val[key]
                else:
                    return None
            return val if isinstance(val, str) else json.dumps(val)

        def replace(match: re.Match) -> str:
            expr = match.group(1).strip()

            # {{output}} or {{output.field...}}
            if expr == "output":
                return text
            if expr.startswith("output."):
                if not isinstance(own_parsed, dict):
                    return match.group(0)
                resolved = _lookup_path(own_parsed, expr[len("output."):].split("."))
                return resolved if resolved is not None else match.group(0)

            # {{nodes.<Name>}} | {{nodes.<Name>.output}} | {{nodes.<Name>.output.field...}}
            if expr.startswith("nodes."):
                rest = expr[len("nodes."):]
                # Split off the trailing ".output[.field...]" segment, keeping the name intact.
                if ".output" in rest:
                    name, _, tail = rest.partition(".output")
                else:
                    name, tail = rest, ""
                node_text = nodes.get(name.strip().lower())
                if node_text is None:
                    return match.group(0)
                if tail in ("", ".output"):
                    return node_text
                if tail.startswith("."):
                    parsed = AgentManager._extract_json(node_text)
                    if not isinstance(parsed, dict):
                        return match.group(0)
                    resolved = _lookup_path(parsed, tail.lstrip(".").split("."))
                    return resolved if resolved is not None else match.group(0)
                return match.group(0)

            return match.group(0)

        # Allow names with spaces and most punctuation, but not braces.
        return re.sub(r"\{\{([^{}]+)\}\}", replace, transform)
```

- [ ] **Step 2: Commit**

```bash
git add backend/agents/agent_manager.py
git commit -m "Phase E: extend _apply_transform with {{nodes.<Name>.output[.path]}}"
```

---

## Task 2: Backend — build `nodes_map` in `route_to_downstream` and pass it through

**Files:**
- Modify: `backend/agents/agent_manager.py:128-237` (the `route_to_downstream` function and the `_route_single` inner)

- [ ] **Step 1: Add the `_last_assistant_text` helper at module scope**

In `backend/agents/agent_manager.py`, add this helper above `route_to_downstream` (around line 127, before the function declaration):

```python
def _last_assistant_text(card_id: str, agent_mgr: "AgentManager") -> str | None:
    """Return the last assistant text for an agent session, or None for non-agent cards."""
    session = agent_mgr.sessions.get(card_id)
    if not session:
        return None
    for msg in reversed(session.messages):
        if msg.role == "assistant":
            return msg.content if isinstance(msg.content, str) else str(msg.content)
    return None
```

- [ ] **Step 2: Build `nodes_map` once per `route_to_downstream` call and pass it into `_apply_transform`**

In `route_to_downstream`, immediately after the `outgoing = [...]` line at `backend/agents/agent_manager.py:145` (and *before* the `if not outgoing: return` guard), add:

```python
    # Build name → last-assistant-text for every node with a direct inbound edge to any of this run's targets.
    # Reused across all `_route_single` calls within this routing pass.
    target_ids = {c.to_card_id for c in outgoing}
    inbound = [c for c in connections if c.to_card_id in target_ids]
    nodes_map: dict[str, str] = {}
    for c in inbound:
        name = _get_target_name(c.from_card_id)
        if not name:
            continue
        upstream_text = _last_assistant_text(c.from_card_id, agent_mgr)
        if upstream_text is None:
            continue
        nodes_map[name.lower()] = upstream_text
```

Note: `_get_target_name` is already defined later in the function as a closure (line 172). **Move it above this insertion point** so it's in scope. Cut the `def _get_target_name(target_id: str) -> str | None:` block from lines 172-191 and paste it just before the `# Build name → ...` comment block above.

- [ ] **Step 3: Pass `nodes_map` into the existing `_apply_transform` call**

At `backend/agents/agent_manager.py:237`, change:

```python
        if conn.transform:
            routed_text = AgentManager._apply_transform(conn.transform, routed_text)
```

to:

```python
        if conn.transform:
            routed_text = AgentManager._apply_transform(conn.transform, routed_text, nodes_map)
```

- [ ] **Step 4: Commit**

```bash
git add backend/agents/agent_manager.py
git commit -m "Phase E: thread upstream nodes map through route_to_downstream"
```

---

## Task 3: Backend — verification script for every grammar branch

**Files:**
- Create: `scripts/verify_expression_language.py`

- [ ] **Step 1: Create the script**

```python
"""Verify _apply_transform handles every documented grammar branch.

Run from repo root:  python -m scripts.verify_expression_language
Exits non-zero on any failure; prints PASS/FAIL per case.
"""
from __future__ import annotations

import sys

from backend.agents.agent_manager import AgentManager

CASES = [
    # (label, transform, text, nodes, expected)
    ("output full",            "{{output}}",                      "hello",                                  None,                                "hello"),
    ("output JSON path",       "Got: {{output.summary}}",         '{"summary":"yes"}',                      None,                                "Got: yes"),
    ("output missing path",    "{{output.nope}}",                 '{"summary":"yes"}',                      None,                                "{{output.nope}}"),
    ("output non-JSON path",   "{{output.x}}",                    "not json",                               None,                                "{{output.x}}"),
    ("nodes full",             "{{nodes.Researcher.output}}",     "ignored",                                {"researcher": "raw text"},          "raw text"),
    ("nodes JSON path",        "{{nodes.Bot.output.title}}",      "",                                       {"bot": '{"title":"Hi"}'},           "Hi"),
    ("nodes case insensitive", "{{nodes.alice.output}}",          "",                                       {"alice": "x"},                      "x"),
    ("nodes spaces in name",   "{{nodes.Devil's advocate.output}}", "",                                     {"devil's advocate": "y"},           "y"),
    ("nodes unknown",          "{{nodes.Ghost.output}}",          "",                                       {"alice": "x"},                      "{{nodes.Ghost.output}}"),
    ("nodes missing field",    "{{nodes.Bot.output.gone}}",       "",                                       {"bot": '{"title":"Hi"}'},           "{{nodes.Bot.output.gone}}"),
    ("nodes non-JSON path",    "{{nodes.Bot.output.x}}",          "",                                       {"bot": "plain"},                    "{{nodes.Bot.output.x}}"),
    ("mixed",                  "A={{output}} B={{nodes.X.output}}", "from-text",                            {"x": "from-x"},                     "A=from-text B=from-x"),
    ("nested JSON path",       "{{nodes.Bot.output.a.b}}",        "",                                       {"bot": '{"a":{"b":"deep"}}'},       "deep"),
    ("None nodes is fine",     "{{output}}",                      "hello",                                  None,                                "hello"),
]


def main() -> int:
    failures = 0
    for label, transform, text, nodes, expected in CASES:
        got = AgentManager._apply_transform(transform, text, nodes)
        ok = got == expected
        print(f"[{'PASS' if ok else 'FAIL'}] {label}")
        if not ok:
            print(f"    transform: {transform!r}")
            print(f"    expected:  {expected!r}")
            print(f"    got:       {got!r}")
            failures += 1
    print(f"\n{len(CASES) - failures}/{len(CASES)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it and confirm every case passes**

```bash
cd /home/barrulus/dev/agentcanvas && python -m scripts.verify_expression_language
```

Expected last line: `14/14 passed`. Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify_expression_language.py
git commit -m "Phase E: verification script for transform grammar"
```

---

## Task 4: Backend — update model docstring

**Files:**
- Modify: `backend/agents/models.py:77`

- [ ] **Step 1: Replace the inline comment**

Change:

```python
    transform: Optional[str] = None  # Template string: {{output}} for full text, {{output.field}} for JSON field access
```

to:

```python
    transform: Optional[str] = None  # Template: {{output}}, {{output.field}}, {{nodes.<Name>.output}}, {{nodes.<Name>.output.field}} — see docs/workflows.md
```

- [ ] **Step 2: Commit**

```bash
git add backend/agents/models.py
git commit -m "Phase E: document new transform syntax on Connection model"
```

---

## Task 5: Frontend — upstream picker component

**Files:**
- Create: `frontend/src/app/pages/Canvas/upstreamPicker.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useMemo, useState } from 'react'

export type UpstreamNode = { id: string; name: string; isImmediate: boolean }

type LastRun = { response_out?: string | null }

function discoverPaths(json: unknown, prefix = '', depth = 0): string[] {
  if (depth > 3 || json === null || typeof json !== 'object' || Array.isArray(json)) return []
  return Object.entries(json as Record<string, unknown>).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k
    return [path, ...discoverPaths(v, path, depth + 1)]
  }).slice(0, 20)
}

function parseJsonLoose(text: string | null | undefined): unknown {
  if (!text) return null
  try {
    return JSON.parse(text.trim())
  } catch {
    // Try to find a JSON object embedded in the text (mirrors backend _extract_json).
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}

export function UpstreamPicker({
  upstream,
  onInsert,
}: {
  upstream: UpstreamNode[]
  onInsert: (snippet: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string>('')
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => upstream.find((u) => u.id === selectedId), [upstream, selectedId])

  useEffect(() => {
    if (!selectedId) { setLastRun(null); setError(null); return }
    let cancelled = false
    setError(null)
    fetch(`/api/sessions/${selectedId}/last-run`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => { if (!cancelled) setLastRun(data) })
      .catch((e) => { if (!cancelled) { setLastRun(null); setError(String(e?.message ?? e)) } })
    return () => { cancelled = true }
  }, [selectedId])

  const paths = useMemo(() => {
    const parsed = parseJsonLoose(lastRun?.response_out ?? null)
    return discoverPaths(parsed)
  }, [lastRun])

  const buildSnippet = (path: string | null) => {
    if (!selected) return ''
    if (selected.isImmediate) return path ? `{{output.${path}}}` : `{{output}}`
    return path ? `{{nodes.${selected.name}.output.${path}}}` : `{{nodes.${selected.name}.output}}`
  }

  if (upstream.length === 0) return null

  return (
    <div style={{ marginBottom: 8, padding: 8, background: '#13132a', borderRadius: 6, border: '1px solid #2a2a44' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#888' }}>Insert from upstream:</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{ flex: 1, background: '#0d0d1f', color: '#e0e0e0', border: '1px solid #333', borderRadius: 4, padding: '4px 6px', fontSize: 12 }}
        >
          <option value="">— pick a node —</option>
          {upstream.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}{u.isImmediate ? ' (immediate)' : ''}
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button
            type="button"
            onClick={() => onInsert(buildSnippet(null))}
            style={chipStyle}
            title="Insert full text"
          >
            output
          </button>
          {paths.map((p) => (
            <button key={p} type="button" onClick={() => onInsert(buildSnippet(p))} style={chipStyle} title={`Insert ${p}`}>
              {p}
            </button>
          ))}
          {paths.length === 0 && lastRun && (
            <span style={{ fontSize: 11, color: '#666' }}>No JSON fields detected in last output.</span>
          )}
          {error && <span style={{ fontSize: 11, color: '#888' }}>Couldn't load output preview.</span>}
        </div>
      )}
    </div>
  )
}

const chipStyle: React.CSSProperties = {
  padding: '2px 8px',
  background: '#1f1f3a',
  color: '#9fd9ff',
  border: '1px solid #2a3a5a',
  borderRadius: 10,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'monospace',
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/pages/Canvas/upstreamPicker.tsx
git commit -m "Phase E: upstream picker component for transform autocomplete"
```

---

## Task 6: Frontend — wire the picker into the contract editor modal

**Files:**
- Modify: `frontend/src/app/pages/Canvas/Canvas.tsx` (the `editingConn` modal block at lines 239-330, plus state at line 55)

- [ ] **Step 1: Add the import at the top of `Canvas.tsx` (alongside other local imports near line 28)**

```tsx
import { UpstreamPicker, type UpstreamNode } from './upstreamPicker'
```

- [ ] **Step 2: Extend the `editingConn` state shape to remember which connection is being edited**

At `Canvas.tsx:55-61`, the state already includes `connId`. We also need the connection's `to` and `from` for the upstream computation. Either pull them from `connections` by `connId` (no state change needed) or add to state. Use the lookup approach — no state shape change.

Add this `useMemo` inside `CanvasInner`, just after the `editingConn` state declaration (around line 62):

```tsx
  const upstreamNodes = useMemo<UpstreamNode[]>(() => {
    if (!editingConn) return []
    const conn = connections.find((c) => c.id === editingConn.connId)
    if (!conn) return []
    const cardName = (id: string): string | null => cards[id]?.name ?? null
    const inbound = connections.filter((c) => c.to_card_id === conn.to_card_id)
    const seen = new Set<string>()
    const out: UpstreamNode[] = []
    for (const c of inbound) {
      if (seen.has(c.from_card_id)) continue
      seen.add(c.from_card_id)
      const name = cardName(c.from_card_id)
      if (!name) continue
      out.push({ id: c.from_card_id, name, isImmediate: c.from_card_id === conn.from_card_id })
    }
    return out
  }, [editingConn, connections, cards])
```

> Note on `cards[id]?.name`: this assumes the canvas slice exposes a card-name field. If it doesn't, replace the body with a lookup against `useSelector((s: RootState) => s.agents.sessions[id]?.name)` plus a fallback for non-session cards. Inspect `canvasSlice.ts` to confirm the field name before writing this; the dropdown is hint-only, so unmapped cards just get filtered out.

- [ ] **Step 3: Add a textarea ref so the picker can insert at the cursor**

In `CanvasInner`, add (anywhere with the other `useState` calls):

```tsx
  const transformRef = useRef<HTMLTextAreaElement | null>(null)
```

Add the import at the top: `import { useRef } from 'react'` (or extend the existing react import).

- [ ] **Step 4: Render the picker above the existing transform textarea**

In `Canvas.tsx`, find the block at lines 277-286 (the `Transform template` label + textarea). Replace just the textarea (line 281-286) with:

```tsx
            <UpstreamPicker
              upstream={upstreamNodes}
              onInsert={(snippet) => {
                const ta = transformRef.current
                const current = editingConn.transform || ''
                if (!ta) {
                  setEditingConn((c) => (c ? { ...c, transform: current + snippet } : c))
                  return
                }
                const start = ta.selectionStart ?? current.length
                const end = ta.selectionEnd ?? current.length
                const next = current.slice(0, start) + snippet + current.slice(end)
                setEditingConn((c) => (c ? { ...c, transform: next } : c))
                requestAnimationFrame(() => {
                  ta.focus()
                  const pos = start + snippet.length
                  ta.setSelectionRange(pos, pos)
                })
              }}
            />
            <textarea
              ref={transformRef}
              value={editingConn.transform}
              onChange={(e) => setEditingConn((c) => (c ? { ...c, transform: e.target.value } : c))}
              placeholder="{{output.summary}}"
              style={{ ...textareaStyle, minHeight: 48 }}
            />
```

- [ ] **Step 5: Update the help text to mention the new syntax**

At `Canvas.tsx:279`, change:

```tsx
              <span style={{ color: '#555', fontWeight: 400 }}>{' — {{output}} for full text, {{output.field}} for JSON fields'}</span>
```

to:

```tsx
              <span style={{ color: '#555', fontWeight: 400 }}>{' — {{output}}, {{output.field}}, {{nodes.<Name>.output[.field]}}'}</span>
```

- [ ] **Step 6: Verify the frontend builds**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/pages/Canvas/Canvas.tsx
git commit -m "Phase E: wire upstream picker into contract editor"
```

---

## Task 7: Docs — workflows.md transform expressions section

**Files:**
- Modify: `docs/workflows.md` (around line 162, the "Transform" row of the contract table)

- [ ] **Step 1: Add a new subsection right after the contract table**

Find the row in the contract table at `docs/workflows.md:162` that documents `Transform`. Immediately after the table block ends, insert:

```markdown
### Transform expressions

The transform field is a small templating language run on the upstream output before it's forwarded.

**Grammar**

| Placeholder | Resolves to |
|---|---|
| `{{output}}` | Full text of the immediate upstream node |
| `{{output.field}}` | JSON dot-path into the immediate upstream's parsed output |
| `{{nodes.<Name>.output}}` | Full text of any node with a direct inbound edge to the receiver, looked up by case-insensitive name |
| `{{nodes.<Name>.output.field}}` | JSON dot-path into that named node's parsed output |

`<Name>` matches the card's display name (case-insensitive, may contain spaces). If two upstreams share a name the first match wins and a warning is logged — the connection editor's picker prevents this by listing real names.

If a placeholder fails to resolve (unknown node, missing field, output isn't JSON) it is left intact in the rendered string. This is deliberate — silent corruption is worse than a visible placeholder.

Only **direct** inbound edges of the receiving node are reachable. Transitive walking and an n8n-style expression engine (`$now`, `$workflow`, jsonpath, JS sandbox) are out of scope by design.

**Examples**

Single-upstream JSON pluck:

```
Summary: {{output.summary}}
```

Multi-upstream aggregator (e.g. an "Editor" agent that has two inbound edges from "Optimist" and "Pessimist"):

```
Pros from {{nodes.Optimist.output.points}}
Cons from {{nodes.Pessimist.output.points}}
```

Forwarding raw text from a non-JSON upstream by name:

```
{{nodes.Researcher.output}}
```

**Discoverability**

In the canvas, right-click any connection → *Edit data contract*. The transform field has an **Insert from upstream** strip: pick an upstream node, then click any detected JSON field to insert the matching placeholder at the cursor.
```

- [ ] **Step 2: Update the `transform` row in `docs/data-models.md:73`**

Change:

```
| `transform` | string? | null | Template: `{{output}}` for full text, `{{output.field}}` for JSON fields |
```

to:

```
| `transform` | string? | null | Template — see [Transform expressions](workflows.md#transform-expressions) for the full grammar |
```

- [ ] **Step 3: Commit**

```bash
git add docs/workflows.md docs/data-models.md
git commit -m "Phase E: document transform expression grammar"
```

---

## Task 8: Manual smoke test

**No new files.**

- [ ] **Step 1: Start the dev stack**

```bash
cd /home/barrulus/dev/agentcanvas && ./run.sh
```

Wait for both backend and frontend to come up.

- [ ] **Step 2: Build a 2→1 fan-in workflow on the canvas**

1. Create three agent cards: `Optimist`, `Pessimist`, `Editor`.
2. Give `Optimist` and `Pessimist` short prompts that produce JSON, e.g. `Reply ONLY with JSON like {"points":"<two short points>"}`.
3. Connect `Optimist → Editor` and `Pessimist → Editor`.
4. Right-click the `Pessimist → Editor` connection → *Edit data contract* → confirm the **Insert from upstream** dropdown lists both `Optimist` and `Pessimist (immediate)`.
5. Pick `Optimist`, click the `points` chip, then add literal text `\nCons: ` and click `Pessimist`'s `points` chip. Save.
6. Trigger `Optimist` and `Pessimist` with a question. After both complete, send anything to `Editor` to fire the route — verify its incoming prompt contains both upstreams' `points` interpolated.

- [ ] **Step 3: Verify back-compat**

On a separate edge, set `transform = "Summary: {{output.summary}}"` against an upstream that emits `{"summary":"hi"}`. Confirm `Editor` sees `Summary: hi`.

- [ ] **Step 4: Verify failure mode**

Set `transform = "{{nodes.Ghost.output}}"` (no such node). Confirm the placeholder is forwarded literally — not corrupted, not crashing the route.

- [ ] **Step 5: Commit nothing — this is a manual gate**

If anything fails, file a defect against the offending task and re-execute.

---

## Self-Review Notes

- **Spec coverage:** every grammar rule (§Grammar), backend wiring (§Backend changes), frontend picker (§Frontend changes), and docs (§Docs) maps to a task above. Out-of-scope items (`$now`, jsonpath, `system_prompt` use, transitive walking) stay omitted — Task 1's docstring + Task 7's docs make the boundary explicit.
- **Type consistency:** `nodes_map` is `dict[str, str]` everywhere; `_apply_transform`'s param matches; `UpstreamNode` shape is shared via the picker module's export.
- **No placeholders:** every step shows the exact code or command. The one note in Task 6 about `cards[id]?.name` is the only conditional — flagged inline with explicit fallback guidance.
- **Test approach:** the repo has no test framework configured today, so verification is a runnable Python script (Task 3) plus a manual UI gate (Task 8). Adding pytest scaffolding for one method is YAGNI for this phase; defer to whenever the project gains a test suite.
