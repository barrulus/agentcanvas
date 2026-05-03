# xyflow Migration & n8n-Inspired Feature Plan

This document plans the migration of AgentCanvas's hand-rolled spatial canvas to [xyflow](https://github.com/xyflow/xyflow) (React Flow), bundles in a set of n8n-inspired feature additions that the migration unlocks, and addresses workflows-as-code-in-git as a follow-on.

## Why bundle these together

The xyflow swap is the right substrate for the n8n-style ideas because each feature below maps to a specific xyflow primitive (custom nodes, custom edges, selection events, viewport state, parent nodes for groups). Hand-rolled SVG would punish any of them. Bundling keeps the migration from being pure churn — every line of canvas code we delete pays for itself in features built on top.

---

## Part 1 — xyflow migration

### 1.1 Install & wire up

- `npm i @xyflow/react` in `frontend/`
- Import `'@xyflow/react/dist/style.css'` once in `App.tsx`
- Wrap `Canvas.tsx`'s viewport in `<ReactFlowProvider>` (one provider per dashboard mount, or one global with keyed remount on dashboard switch)

### 1.2 Data-model mapping (no schema migration needed)

Current shapes already align with xyflow — adapter functions only, no Redux changes:

| Current (`canvasSlice.ts`) | xyflow |
|---|---|
| `CardPosition { session_id, x, y, width, height, card_type, collapsed, zOrder }` | `Node { id: session_id, position: {x,y}, type: card_type, data: { collapsed, zOrder, width, height }, width, height }` |
| `Connection { id, from, to, condition, output_schema, transform, gate_rule }` | `Edge { id, source: from, target: to, type: 'agentEdge', data: { condition, output_schema, transform, gate_rule } }` |
| `CardGroup { memberIds, collapsed, color }` | parent `Node { type: 'group' }` + child `parentNode` refs |
| `blockedConnections[connId] = reason` | edge `data.blockedReason` → drives stroke color in custom edge |

Add two selectors `selectNodes(state)` and `selectEdges(state)` that synthesize xyflow shapes from the existing slice. Keep Redux as source of truth; on `onNodesChange` / `onEdgesChange` dispatch to existing reducers (`moveCard`, `addConnection`, `removeConnection`).

### 1.3 Custom node types

One `nodeType` per existing card component — they keep most of their JSX, just lose absolute-positioning wrapper:

```ts
const nodeTypes = {
  agent: AgentCardNode,       // wraps AgentCard.tsx body
  view: ViewCardNode,         // wraps ViewCardComponent.tsx body
  input: InputCardNode,
  gate: GateCardNode,
  dialogue: DialogueCardNode,
  group: GroupNode,           // replaces groups rendering
}
```

Each gets one `<Handle type="target" position={Position.Left}/>` + one `<Handle type="source" position={Position.Right}/>` (matches today's single-port model — `{{route:Name}}` is content-based and stays server-side, untouched).

BPMN collapse: handled inside the node component by toggling `data.collapsed` and reporting different `width`/`height` via `useUpdateNodeInternals`.

### 1.4 Custom edge type

Single `AgentEdge` component replacing the SVG block at `Canvas.tsx:518–614`:

- Default path via `getBezierPath` / `getSmoothStepPath`
- Reads `data.condition`/`data.gate_rule`/`data.blockedReason` to pick stroke color and dash array (same logic as today, just inside the edge component)
- Inline edit popover migrates from `editingConn` state to `EdgeLabelRenderer`
- **Add** a `data.lastRunStats` slot (token count, transform-output preview) — Phase B of the feature work fills it in

### 1.5 Built-ins to adopt

- `<Background variant="dots" gap={prefs.gridSize}/>` — replaces hand-drawn grid
- `<Controls/>` and `<MiniMap/>` — new, free
- `fitView` / `zoomTo` — wire to existing toolbar buttons in `Toolbar.tsx`
- `selectionOnDrag` + `panOnDrag={[1,2]}` — replaces marquee logic at `Canvas.tsx:88`, `181–198`, `201–258`
- `onNodesChange` with `applyNodeChanges` + dispatching `moveCard`/`moveSelected` — replaces group-drag block
- `onConnect` callback → `addConnection` thunk — replaces `drawingFrom` flow (`Canvas.tsx:72`, `261–276`, `616–640`)
- `deleteKeyCode={['Delete','Backspace']}` — replaces the keydown listener at `Canvas.tsx:97–114`

### 1.6 Multi-dashboard

`currentDashboardId` becomes the React key on `<ReactFlow>`. Per-dashboard viewport state (pan/zoom) moves into `dashboards[id].viewport: {x,y,zoom}` and is restored via `defaultViewport` on mount. Reuse existing `debouncedSaveLayout`.

### 1.7 Shared status bar

Lift the BPMN-style colored status bar (currently implicit inside `AgentCard.tsx`) into a shared `<NodeStatusBar/>` so all five node types pick it up — bound to `AgentSession.status` (red on `error`, amber on `running`, green on `completed`).

### 1.8 Migration sequence (each step independently shippable)

1. **Adapter layer** — selectors + change handlers; no UI change yet, verify in unit tests
2. **Skeleton swap** — replace `Canvas.tsx` viewport with `<ReactFlow>`, render existing card components inside `agent` nodeType only; pan/zoom/select via xyflow
3. **Edges** — `AgentEdge` with full styling/condition/blocked rendering; remove SVG block
4. **Remaining node types** — view/input/gate/dialogue
5. **Groups** — convert to xyflow parent nodes
6. **Polish** — minimap, fit-view button, snap-to-grid from prefs
7. **Delete dead code** — `drawingFrom`, `marquee`, `groupDrag`, `screenToCanvas`, manual wheel handlers, port helpers (`Canvas.tsx:69–276`, `328–354`, `518–640`) → `Canvas.tsx` should land near 250–300 lines

### 1.9 Risks & watch-list

- **DialogueCardComponent (718 lines)** has nested layout + scroll; verify it works inside an xyflow node (it should — node content is arbitrary JSX, but check that internal scrolling doesn't fight xyflow's wheel handler — set `nowheel` class on scrollable inner divs)
- **Z-order**: today's `nextZOrder` becomes xyflow's `zIndex` field on Node — bring-to-front still works
- **WebSocket-driven updates** in `shared/ws/` push card moves/state — keep dispatching to Redux; xyflow re-derives via the selector
- **framer-motion** card animations may collide with xyflow's transform; if so, animate inner content only, not the node wrapper

### 1.10 Estimate

~1.5 days for steps 1–4 (the visible swap), ~0.5 day for groups + polish + cleanup. Net code change: roughly **−1500 / +500 lines** in the Canvas page.

---

## Part 2 — n8n-inspired feature additions

The Claude.ai critique was sharp: agentcanvas's closest analogue is n8n + LangGraph Studio, not OpenClaw. Specific n8n features worth porting, mapped against what AgentCanvas already has.

### 2.1 What we already have (don't rebuild)

- **Webhook trigger node** — `POST /api/input-cards/{card_id}/webhook` exists at `backend/main.py:434`. The piece missing is **webhook *response*** — a way for an external caller to await a workflow result synchronously.
- **Run state per card** — `AgentSession.status` already tracks `idle|running|completed|error|stopped`, plus `cost_usd` and `tokens` (`backend/agents/models.py:32-40`). The data exists; the canvas just doesn't surface it richly.
- **Transform expressions** — `_apply_transform` at `backend/agents/agent_manager.py:896` already supports `{{output}}` and `{{output.field}}` dot-paths. This is the inter-node data axis. It's just thin and undocumented.
- **Branching** — `messages[].parent_id`/`branch_id` and `/sessions/{id}/branch` exist. The "execution history" axis is partially there.

### 2.2 What's genuinely missing

1. **Failed-run inspectability** — when a card goes `error`, there's no UI to click and see the exact prompt-in / response-out / stderr / token cost for that specific failed run.
2. **Workflow definition vs execution as separate concepts** — today, a "run" is overlaid on the live workflow; there's no immutable `WorkflowRun` record you can replay or compare.
3. **Webhook *response*** node — only one half of the loop exists.
4. **Expression language docs + autocomplete** — `{{output.field}}` works but isn't discoverable; users won't find it.

### 2.3 Phase B — Node inspection UX (the n8n killer feature)

**Backend**

- New endpoint `GET /api/sessions/{id}/last-run` returning `{ status, started_at, ended_at, duration_ms, prompt_in, response_out, error_text?, token_in, token_out, cost_usd, transform_applied?, downstream_routes: [...] }`. Mostly aggregates existing `Message` data — no new storage yet.
- WebSocket: extend `agents/ws_manager.py` `broadcast_dashboard` to emit `card:run-summary` on every status transition so the canvas can update without polling.

**Frontend (xyflow-native)**

- Click a node → opens an `<NodeInspectorPanel/>` docked right (use xyflow's `useOnSelectionChange`).
- Tabs: **Input** (resolved prompt after upstream transform), **Output** (raw + parsed JSON tree), **Errors** (full stderr/exception trace), **Cost** (tokens + USD), **Connections** (downstream routes taken — which `{{route:X}}` matched).
- For failed runs: surface the prompt that was sent — that's the single most-asked debugging question.

### 2.4 Phase C — Workflow definition vs execution

Today: workflow state lives in `canvas.connections` + `cards`; runs mutate session state in place.

- Introduce a `WorkflowRun` record: `{ id, dashboard_id, started_at, ended_at, trigger: 'manual'|'webhook', card_runs: [{card_id, session_snapshot, status, ...}] }`. Persist alongside sessions.
- New `runs/store.py`. New routes: `GET /api/dashboards/{id}/runs`, `GET /api/runs/{run_id}`, `POST /api/runs/{run_id}/replay`.
- Frontend: a **"Runs" drawer** in `Toolbar.tsx`. Selecting a past run **dims the live canvas** and overlays that run's status colors/numbers on each node — xyflow makes this trivial because `data` updates re-render only affected nodes.
- Cheap MVP: don't snapshot card configs initially, just record `card_id → AgentSession.id` references and timestamps. Snapshotting comes when you want true replay.

### 2.5 Phase D — Webhook response node

- Add a new card type: `OutputCard` (or extend `ViewCard` with a `webhook_response` mode).
- New flow: external `POST /api/workflows/{dashboard_id}/invoke` with body → routes to that dashboard's input card → workflow runs → terminal `OutputCard` resolves the awaiting HTTP request with its content.
- Backend: `asyncio.Future` keyed by `run_id`, resolved when the run reaches an `OutputCard` (or times out). Reuse the `WorkflowRun` plumbing from Phase C.
- This is the **cheapest interop win** — agentcanvas becomes callable from NiFi, n8n, cron. One new endpoint + one new node type.

### 2.6 Phase E — Expression language polish

Existing `{{output}}` / `{{output.field}}` works but is an island. Make it discoverable:

- Extend the syntax to upstream-by-name: `{{nodes.AgentName.output}}`, `{{nodes.AgentName.output.field}}`. Implementation: walk inbound edges in `_route_output`, build a dict, render template. Backwards-compatible with current `{{output}}`.
- Frontend: in the connection edit popover (currently `editingConn` in `Canvas.tsx:79`), the transform field gets a dropdown listing reachable upstream nodes + a JSON tree of their last output → click to insert path.
- Doc page in `docs/workflows.md` with examples — discoverability matters more than the feature itself.

### 2.7 Reordered build sequence

1. **Phase A (xyflow swap)** — must come first; everything else attaches to it. ~2 days.
2. **Phase B (node inspection)** — biggest UX delta for least code; uses data you already have. ~1 day.
3. **Phase E (expression docs + autocomplete)** — small, ships standalone, unblocks user complaints. ~0.5 day.
4. **Phase D (webhook response)** — interop unlock, mostly backend. ~1 day.
5. **Phase C (runs as records)** — biggest scope; do last because B + D both inform what fields the `WorkflowRun` needs. ~2 days.

### 2.8 Positioning note

The Claude.ai framing — *"a visual editor for agent graphs where multi-turn dialogues, arbitration, and circuit-breaking are first-class primitives"* — is worth pulling into `README.md` Highlights. Gate cards and dialogue cards are the actual differentiator; the README currently buries them in a sub-bullet. Not part of this plan but is the same length as a sentence rewrite.

### 2.9 What to skip

- **A full n8n-style expression engine** (jsonpath, JS sandbox, `$now`, `$workflow`, etc.). The current `{{output.field}}` covers ~80% of cases; pushing further is a tarpit. Dialogue cards and gate cards are the differentiator — agent-graph primitives, not data plumbing.
- **Workflow versioning separate from runs** in v1. Phase C's `WorkflowRun` records are sufficient for "what happened on this run." Versioning the *definition* is a separate, larger problem.

---

## Part 3 — Workflows as code in git

xyflow itself doesn't change anything here — workflows are already serialisable; what's missing is the import/export and a stable on-disk format. The migration helps marginally because xyflow's node/edge shapes are flat and JSON-friendly, but the real work is independent.

### 3.1 What we already have

- `GET/PUT /api/dashboards/{id}/layout` (`backend/main.py:738/750`) round-trips the full canvas state.
- The state is plain data: `cards` (positions + types + collapsed), `connections` (with `condition`/`transform`/`gate_rule`/`output_schema`), `groups`, `constraints`. All JSON-serialisable today.
- What's **not** in the layout: per-session config that lives on `AgentSession` (`provider_id`, `model`, `system_prompt`, `tools_enabled`, `mode_id`, MCP permissions). Today those are owned by the live session, not the workflow definition.

### 3.2 What "workflows as code in git" needs

Two changes, both small, neither requiring xyflow:

1. **Split definition from runtime state.** Today `session_id` *is* the card identity. To version a workflow, cards need a stable `card_id` (or slug like `summariser`) separate from the ephemeral session that runs them. Card definition holds: `{ id, type, name, provider_id, model, system_prompt, tools_enabled, mode_id, mcp_permissions, position, ... }`. The runtime session points back via `card_id`. **This is the same refactor Phase C already requires** for `WorkflowRun` records — do it once, both features benefit.

2. **An export/import format + CLI.** A `Workflow` file (YAML or JSON) containing `{ version, dashboard, cards[], connections[], groups[], constraints, modes[], mcp_servers[]? }`. New routes `GET /api/dashboards/{id}/export` and `POST /api/workflows/import`. A small CLI `agentcanvas export <dashboard> > flow.yaml` / `agentcanvas import flow.yaml` makes it git-friendly without forcing the canvas to live on disk.

### 3.3 Format choice

**YAML, not JSON**, for the on-disk artefact — diffs are readable, prompts are multi-line strings, comments are useful. Keep `layout` (positions, sizes, group colours) in a sibling `flow.layout.json` so prompt edits don't churn the diff with pixel coordinates. Two files, one logical workflow, clean PRs.

### 3.4 Things to decide deliberately

- **Secrets**: API keys / MCP OAuth tokens **must not** end up in the file. Reference modes/mcp-servers by id; let users keep secrets in a local config the file never touches.
- **Provider/model portability**: `provider_id: claude-code` + `model: claude-opus-4-7` works on one machine but breaks on someone else's without auth. Acceptable; document it.
- **MCP server references**: include the *intent* (server id + tool names + permission policy), not the connection details. Importer warns if referenced servers aren't configured locally.
- **Round-trip stability**: exporting then immediately reimporting must yield byte-identical files. Order keys deterministically; sort `connections` by `(from, to)`.

### 3.5 Where xyflow does help, marginally

- xyflow's `Node`/`Edge` shapes are already the canonical "flat list of objects with ids and references" structure that exports cleanly. After Phase A, the export endpoint becomes ~30 lines: walk the Redux selectors, drop transient fields (`zOrder`, `selected`, `dragging`), serialise.
- `fitView` on import means a freshly-cloned workflow looks right immediately even if positions are stale.

### 3.6 Scope

Maybe 1 day on top of Phase C, mostly backend (export/import endpoints + CLI subcommand + a `Workflow` Pydantic model for validation). The card-definition split is the load-bearing piece, and we're doing it for runs anyway.

**Bottom line:** workflows-as-code is achievable, but the unlock is the definition/runtime split (Phase C), not xyflow itself. The migration just makes the resulting data shape cleaner to dump.

---

## Summary timeline

| Phase | Scope | Estimate | Depends on |
|---|---|---|---|
| A | xyflow migration (steps 1.1–1.10) | ~2 days | — |
| B | Node inspection UX | ~1 day | A |
| E | Expression language polish + docs | ~0.5 day | — (independent, but easier after A) |
| D | Webhook response node | ~1 day | C (for run plumbing) |
| C | Workflow runs as records + card-definition split | ~2 days | A |
| F | Workflow export/import + CLI | ~1 day | C |

**Total: ~7.5 days of focused work** for a substantially differentiated product: spatial agent-graph editor with first-class run inspection, HTTP interop, and git-versionable workflow definitions, on top of dialogue/gate/circuit-breaker primitives that remain the genuine novelty vs n8n + LangGraph + OpenSwarm.
