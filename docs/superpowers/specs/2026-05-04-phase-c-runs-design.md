# Phase C-MVP — WorkflowRun records + Runs drawer

Add immutable run history to AgentCanvas: every trigger creates a `WorkflowRun` that records what happened, viewable as a list and as a canvas overlay. Sets up Phase F (export/import + replay) without forcing the card-definition split.

## Goals

- Per-trigger atomic runs (one per input-card send, webhook invoke, or manual agent message).
- Every card touched during a run gets a `CardRunRecord` with timing, cost, status, error text, and the connection ids it fired downstream.
- A right-side **Runs drawer** lists runs newest-first; clicking one dims the live canvas and overlays that run's per-card state.
- Forward-compatible naming: the run schema uses `card_id` semantically from day one (today equals `session_id` for agents; Phase F will split them without schema migration).

## Non-goals

- No replay (deferred — needs Phase F card-config snapshots).
- No card-definition split.
- No card-config snapshots inside the run record.
- No retention policy — runs accumulate as JSON; revisit if storage becomes an issue.
- No filter / search in the drawer.
- No multi-dashboard run views.
- No keyboard shortcuts (drawer opens via toolbar icon).

## Run lifecycle

### Trigger-based atomic

A new `WorkflowRun` is created at exactly three call sites:

| Trigger | Where | `trigger` field |
|---|---|---|
| Input card receives content | `POST /api/input-cards/{id}/send` (chat) and the file-watcher / webhook-invoke paths | `'input'` |
| External webhook invoke | `POST /api/workflows/{dashboard_id}/invoke` (Phase D) | `'webhook'` |
| Manual chat send to an agent | `agent:send_message` WS event handler | `'manual'` |

Each trigger creates a run, generates a `run_id`, and threads it through `route_to_downstream(... run_id=run_id)` for that initial routing call. From there, every recursion through the pipeline carries the same `run_id`.

### Reference counting closes the run

`RunManager` tracks `_in_flight: dict[run_id, set[card_id]]`. The set grows when a card is recorded as running for that run, shrinks when it terminates. When `len(_in_flight[run_id]) == 0`, the run closes (status computed from card_runs, `ended_at` set, file written, WS broadcast).

### Card terminal states

A card "exits" the run when it reaches any of:

- **Agent session:** `status` flips to `completed`, `error`, or `stopped`.
- **MergeCard:** emits (`completed`) OR errors (timeout) OR is manually reset (closes as `stopped`).
- **Gate card:** completes resolution OR errors.
- **Dialogue card:** terminates the conversation.
- **View card:** receiving content is itself terminal — it doesn't run anything.
- **Input card:** the trigger card terminates immediately upon firing the first downstream route.

A card may be recorded as "running" multiple times within one run if it receives multiple routed messages — collapsed into one `CardRunRecord` per card per run. `started_at` is set once (first entry) and never overwritten. `ended_at` is updated on each terminal transition; the final value reflects the last time the card finished. Cost/tokens accumulate across re-entries.

### Server restart with open runs

On startup, any persisted `WorkflowRun` with `status='running'` is force-closed as `status='interrupted'`. `ended_at` set to the most recent `card_runs[*].ended_at` if any, else `started_at`. Mirrors the existing `restore_sessions` behavior.

### Stale-run sweep

Runs that have been `running` for > 1 hour are swept and marked `interrupted`. `RunManager` runs a background `asyncio.Task` every 5 minutes checking timestamps. Cheap insurance against ref-count leaks (e.g. a card silently broadcasts a non-standard status that the manager misses).

## Schema

```python
# backend/agents/models.py — append after MergeCard

class CardRunRecord(BaseModel):
    card_id: str                   # today: session_id for agents, gate/dialogue/merge/view/input id for others
    session_id: Optional[str] = None  # today: same as card_id for agents, None for non-agent cards
    card_type: Literal["agent", "gate", "dialogue", "merge", "view", "input"]
    card_name: str                 # snapshot at first run-start so deleted/renamed cards stay identifiable
    status: Literal["running", "completed", "error", "stopped"] = "running"
    started_at: float
    ended_at: Optional[float] = None
    cost_usd: float = 0.0
    tokens: int = 0
    routes_taken: list[str] = Field(default_factory=list)  # connection ids that fired downstream
    error_text: Optional[str] = None


class WorkflowRun(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    dashboard_id: str
    trigger: Literal["input", "webhook", "manual"]
    trigger_card_id: str
    trigger_card_name: str         # snapshot for the same reason
    started_at: float = Field(default_factory=lambda: datetime.now().timestamp())
    ended_at: Optional[float] = None
    status: Literal["running", "completed", "error", "interrupted"] = "running"
    card_runs: list[CardRunRecord] = Field(default_factory=list)
    total_cost_usd: float = 0.0
    total_tokens: int = 0
```

## Backend changes

### New file: `backend/agents/run_manager.py`

Mirrors `merge_manager.py` shape (singleton + storage + manager methods). Public API:

```python
class RunManager:
    cards_by_run_id: dict[str, WorkflowRun]
    _in_flight: dict[str, set[str]]    # run_id → card_ids still running
    _sweep_task: asyncio.Task | None

    def start_run(self, dashboard_id: str, trigger: str, trigger_card_id: str, agent_mgr) -> WorkflowRun: ...

    def record_card_start(self, run_id: str, card_id: str, agent_mgr) -> None:
        # creates or updates the CardRunRecord for this card; resolves card_type/name; adds to in_flight set

    def record_card_end(self, run_id: str, card_id: str, status: str, error_text: str | None = None, cost_usd: float = 0, tokens: int = 0) -> None:
        # closes the CardRunRecord; removes from in_flight; if empty, closes the run

    def record_route(self, run_id: str, conn_id: str, source_card_id: str) -> None:
        # appends to source's CardRunRecord.routes_taken

    def get_run(self, run_id: str) -> WorkflowRun | None: ...
    def list_runs(self, dashboard_id: str, limit: int = 50, offset: int = 0) -> list[WorkflowRun]: ...
    def restore_runs(self) -> None: ...
    async def _sweep_stale_runs(self) -> None: ...   # background task, 5-min cadence
```

Each public mutator persists via `save_workflow_run(run)` then broadcasts `run:update`.

### `backend/sessions/store.py`

Add the same shape as the merge-card storage helpers:

```python
def _runs_dir() -> Path: ...
def save_workflow_run(run: WorkflowRun) -> None: ...
def load_workflow_run(run_id: str) -> WorkflowRun | None: ...
def load_all_workflow_runs() -> list[WorkflowRun]: ...
def delete_workflow_run_file(run_id: str) -> None: ...
```

### `backend/agents/agent_manager.py` — thread `run_id`

The plumbing is the painful part of Phase C. Every routing call site that could be the start or continuation of a run needs `run_id`.

#### `route_to_downstream` signature change

```python
async def route_to_downstream(
    from_card_id: str,
    content: str,
    dashboard_id: str,
    agent_mgr: "AgentManager",
    visited: set[str] | None = None,
    run_id: str | None = None,            # NEW — optional for back-compat with internal callers
) -> None:
```

Inside `_route_single`, after a successful target-branch dispatch:

```python
if run_id:
    run_manager.record_route(run_id, conn.id, from_card_id)
```

Every target-branch dispatch (agent / gate / dialogue / merge / view / input) records the receiving card's start:

```python
if run_id:
    run_manager.record_card_start(run_id, target_id, agent_mgr)
```

The `record_card_end` calls hook into existing terminal-status broadcasts in:
- `agent_manager.py` — wherever an agent's status flips to `completed` / `error` / `stopped`
- `gate_manager.py` — at `_resolve` completion + error path
- `dialogue_manager.py` — at end-of-dialogue + error path
- `merge_manager.py` — at `_emit` + `_timeout` paths

A card needs to know the `run_id` it's currently running under. Two options:

**A. Per-card-type "current run id" tracking.** Each card type's manager stores the run_id when receiving input, retrieves it on terminal-state events.

**B. RunManager-side reverse lookup.** `_in_flight` is `run_id → set[card_id]`; the reverse map `_card_to_run: dict[str, str]` lets terminal events say `"card X just finished"` and the manager finds the run.

Option B is simpler — fewer touch points, no per-manager schema changes. Use B. Caveat: a card can only participate in one run at a time. If a card is mid-run-A and run-B routes to it, run-B blocks until run-A's record on this card closes. This matches MergeCard's existing single-round semantics. Document it.

For agents specifically, `agent_manager.send_message()` and the trigger-emitting endpoints set `_card_to_run[session_id] = run_id` before send. The status-change emitter calls `run_manager.record_card_end(card_to_run[session_id], session_id, status)`.

### `backend/main.py` — new endpoints + trigger wiring

#### Endpoints

```python
@app.get("/api/dashboards/{dashboard_id}/runs")
async def list_runs(dashboard_id: str, limit: int = 50, offset: int = 0):
    runs = run_manager.list_runs(dashboard_id, limit, offset)
    return {"runs": [r.model_dump() for r in runs], "limit": limit, "offset": offset}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = run_manager.get_run(run_id)
    if not run:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return run.model_dump()
```

#### Trigger wiring

Three call sites start a run:

1. **Input card send** (`POST /api/input-cards/{id}/send` and the file-watcher tick): build `run = run_manager.start_run(dashboard_id, 'input', card.id, agent_manager)`. Pass `run_id=run.id` into the `route_to_downstream(...)` call that fires immediately.

2. **Webhook invoke** (`POST /api/workflows/{dashboard_id}/invoke` from Phase D): same as above with `trigger='webhook'`.

3. **Manual agent send** (`agent:send_message` WS handler in `ws_manager.py` / wherever agent sends are wired): build the run, attach `run_id` to whatever `agent_manager.send_message()` invocation happens. The session itself may already have `_card_to_run` from a prior run — overwrite is fine; the card's prior CardRunRecord already closed when the prior run ended.

#### Startup hook

```python
from backend.agents.run_manager import run_manager
run_manager.restore_runs()
```

Mirrors merge/gate/dialogue restore.

### WebSocket event: `run:update`

```python
await ws_manager.broadcast_dashboard("run:update", {"run_id": run.id, "run": run.model_dump()})
```

Sent on:
- Run start (status `running`, empty card_runs)
- Each `record_card_start` / `record_card_end` (running totals updated)
- Run close (status final, `ended_at` set)
- Sweep-as-interrupted

Frontend dispatches `setWorkflowRun(payload.run)` to the new slice.

## Frontend changes

### New files

| File | Responsibility |
|---|---|
| `frontend/src/shared/state/runsSlice.ts` | Redux slice mirroring `mergeCardsSlice`. Exports `WorkflowRun` type, `setWorkflowRun`, `fetchRuns`, `fetchRun`, reducer. |
| `frontend/src/app/pages/Canvas/RunsDrawer.tsx` | Right-side drawer mirroring the existing History drawer's structure. Renders a list of runs with `<RunListItem/>` rows. Click a row → `onSelectRun(id)`. Footer `Load more` button. |
| `frontend/src/app/pages/Canvas/RunOverlayLayer.tsx` | Renders nothing visible itself; subscribes to `runs.activeRunId` and dims live canvas via the existing xyflow node `data` mechanism. Edges in `routes_taken` render solid; others dimmed. Cards not in the run render greyed out. |

### Modified files

| File | Change |
|---|---|
| `frontend/src/shared/state/store.ts` | Wire `runsReducer` |
| `frontend/src/shared/ws/WebSocketManager.ts` | Dispatch `run:update` events |
| `frontend/src/app/pages/Canvas/Toolbar.tsx` | New `Runs` toolbar button (clock-style icon, between the existing clock and cog) opens the drawer |
| `frontend/src/app/pages/Canvas/Canvas.tsx` | Mount `<RunOverlayLayer/>`. When `activeRunId` is set, modify the `selectNodes`/`selectEdges` adapter to apply the overlay |
| `frontend/src/app/pages/Canvas/xyflow/adapters.ts` | When an `activeRun` is selected, transform node data: `cardType` stays the same, but `data.runStatus`, `data.runCost`, `data.runError` are populated from the run's `card_runs`. Cards not in the run set their `data.notInRun = true` (rendered dimmed by the node component). |
| `frontend/src/app/pages/Canvas/AgentCard.tsx` (and `Gate/Dialogue/Merge/View/InputCardComponent.tsx`) | Read `data.notInRun`, `data.runStatus` from xyflow node data; if set, render in overlay mode (status reflects run, dimmed if `notInRun`, click-to-edit disabled with the existing chromeless prop chain). |

The card components already accept `data` from xyflow — adding three optional fields is non-breaking.

### Drawer UI

```
┌─ Runs ────────────────────────────── ✕ ─┐
│  ● 5 min ago · webhook · 12.4s · $0.084 │  ← clickable row
│    Optimist (started_at: 14:32:11)      │     status dot color = run.status
│ ─────────────────────────────────────── │
│  ● 12 min ago · manual · 8.1s · $0.041  │
│    Editor (started_at: 14:25:33)        │
│ ─────────────────────────────────────── │
│  ⚠ 28 min ago · input · 3.2s · $0.012   │
│    Smoke Input (started_at: 14:09:17)   │
│ ─────────────────────────────────────── │
│            [ Load more ]                 │
└──────────────────────────────────────────┘
```

- **Display name resolution:** card name uses live lookup first (`agentSession.name`, `mergeCard.name`, etc.) by `trigger_card_id`. If not found (card was deleted), fall back to `trigger_card_name` snapshot. Always append `started_at` formatted as `HH:MM:SS` next to the name.
- Status dots: green = completed, red = error, blue = running, grey = interrupted.
- Selected row: accent background; clicking again deselects (returns to live).
- Pagination: `Load more` calls `fetchRuns({ dashboardId, offset: current.length })`.

### Detail panel (in-drawer)

When a run is selected, expand the row to show:

```
  Total: 12.4s · $0.084 · 1284 tokens
  Cards (4):
    ✓ Optimist (agent)         3.2s · $0.012
    ✓ Pessimist (agent)        4.1s · $0.018
    ✓ Composer (merge)         <1s
    ✓ Editor (agent)           5.1s · $0.054
  [ Replay (Phase F) ]   ← disabled, tooltip "Available after card-definition split"
  [ Return to live ]
```

### Canvas overlay semantics

- Active overlay: `runs.activeRunId` set → adapter generates node data with overlay fields → cards re-render reflecting run state instead of live state.
- Edges: every edge whose `id` is in any `card_run.routes_taken` renders solid + accent-colored. Others render dimmed grey, no animation.
- Cards not in `card_runs` (i.e. cards on the dashboard that this run didn't touch) render at 30% opacity.
- Editing disabled: card components check `data.notInRun || data.activeRunOverlay` and conditionally suppress the edit-pencil button + drag handles. Existing `chromeless` prop chain extended with a new `readonly` prop.
- "Return to live": dispatches `setActiveRun(null)`; adapter reverts to standard node data.

## Build sequence

1. Backend models + storage + RunManager (no integration yet).
2. Backend: thread `run_id` through `route_to_downstream`, wire trigger call sites, terminal-state hooks across all five card managers.
3. Backend: REST endpoints + WS broadcast + startup restore.
4. Backend: verification script `scripts/verify_workflow_run.py` (mocks dashboard connections + simulates trigger → routing → terminal events → run close).
5. Frontend: slice + WS dispatch + Toolbar button.
6. Frontend: RunsDrawer + RunListItem (no canvas overlay yet).
7. Frontend: canvas overlay (adapter changes + card-component readonly mode).
8. Manual smoke: webhook trigger → see run in drawer; click row → canvas dims and shows overlay; click Return to live → resume editing.

## Risks

- **Reference counting leaks.** Mitigated by stale-run sweep (1h watermark). Worth logging when a sweep fires — it indicates a missed terminal-state hook somewhere. Treat sweep events as bugs to investigate.
- **WS event ordering.** `run:update` carrying a closed run might race the per-card terminal `agent:status` events. Mitigation: drawer reads from Redux state which gets both events; if `run.status` says `completed` but a card_run still says `running`, the drawer trusts the run's roll-up. Acceptable inconsistency window.
- **`_card_to_run` correctness.** A card can only be in one run at a time. If two runs both want to route through the same MergeCard, the second's input goes into the merge's slot but the merge's `card_run` still belongs to run-A. Result: run-B's `card_runs` doesn't include the merge, and the merge's emission downstream still uses run-A's id. **This is the spec for v1** — it matches MergeCard's single-round semantics. Document.
- **Disk fill.** Runs accumulate. ~5KB per run × 1000 runs = 5MB. Acceptable for v1. Defer retention.
- **Card-component readonly mode is tedious to thread.** Five card components each need to respect `data.runOverlay`. We already have a `chromeless` prop chain — extend it rather than introducing a new one.

## Migration / back-compat

- No data migration. Existing sessions keep working as today.
- The `run_id` parameter on `route_to_downstream` is optional with a `None` default, so any internal call site we miss continues to work (just doesn't contribute to a run record). Worth grepping at end of integration to confirm all known callers pass it.
- Existing per-session inspector panel (Phase B) is unchanged. The new Runs drawer is additive.

## Phase F readiness

This MVP makes Phase F a clean cutover:

- `card_id` field is already present in the run record. Phase F changes what it points at (a stable card definition id rather than session_id) without schema migration.
- `card_runs[*].card_name` snapshot survives card renames/deletes — exactly what Phase F's "export then re-import" cycle needs to preserve historical clarity.
- The disabled `Replay` button surfaces the gap to users so the feature ladder is visible.

Implementation plan to follow.
