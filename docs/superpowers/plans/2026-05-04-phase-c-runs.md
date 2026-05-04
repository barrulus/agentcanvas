# Phase C-MVP — WorkflowRun records + Runs drawer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable `WorkflowRun` records that capture every trigger-based execution (input/webhook/manual). Surface them in a right-side **Runs drawer** with a per-run canvas overlay (dim + replace live state with run state). Forward-compatible with Phase F (export/import + replay).

**Architecture:** A new singleton `RunManager` tracks an in-memory `_in_flight: dict[run_id, set[card_id]]`; runs close when the set drains. Every `route_to_downstream` call carries an optional `run_id`. Each card-type manager calls `record_card_end` at terminal-state assignment sites (~14 call sites across agent / gate / dialogue / merge managers). Frontend gains a `runsSlice`, a `RunsDrawer` toolbar entry, and an xyflow adapter that overlays a selected run's per-card status onto the live canvas.

**Tech Stack:** FastAPI + Pydantic backend with asyncio for stale-run sweep; React 19 + Redux Toolkit + xyflow frontend. No test framework — verification by runnable async Python script + manual UI smoke.

**Spec:** `docs/superpowers/specs/2026-05-04-phase-c-runs-design.md`

**Reference patterns to mirror:**
- Backend: `backend/agents/merge_manager.py` (MergeManager structure), `backend/sessions/store.py:147-216` (gate/merge storage helpers).
- Frontend: `frontend/src/shared/state/mergeCardsSlice.ts` (slice structure), `frontend/src/app/pages/History/History.tsx` (existing right-side drawer pattern — read it first to mirror styling).

**Key wire-points (verified):**
- Trigger call sites: `backend/main.py:606` (`POST /api/input-cards/{id}/send`), `:617` (webhook), `:640` (`/api/dashboards/{id}/invoke`), WS handlers at `:1177` and `:1204` (`agent:send_message`).
- Terminal-state assignments: `agent_manager.py:675/677/679/683/721/1110`, `gate_manager.py:103/154/169`, `dialogue_manager.py:120/128/231/242`, `merge_manager.py:152/164/197` — about 14 sites total.
- All input-triggered routing flows through `input_manager.send_to_downstream` — single chokepoint.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/agents/models.py` | Modify | Add `CardRunRecord` + `WorkflowRun` after `MergeCard` |
| `backend/sessions/store.py` | Modify | Add `_runs_dir`, `save_workflow_run`, `load_workflow_run`, `load_all_workflow_runs`, `load_runs_for_dashboard`, `delete_workflow_run_file` |
| `backend/agents/run_manager.py` | Create | RunManager singleton: `start_run`, `record_card_start`, `record_card_end`, `record_route`, `restore_runs`, `_sweep_stale_runs` background task |
| `backend/agents/agent_manager.py` | Modify | Add `run_id: str \| None = None` to `route_to_downstream` + recurse-through; in `_route_single`, call `record_card_start` + `record_route`. Also add `record_card_end` calls at six terminal-state sites. |
| `backend/agents/gate_manager.py` | Modify | Call `record_card_end` at the three terminal-state sites |
| `backend/agents/dialogue_manager.py` | Modify | Call `record_card_end` at the four terminal-state sites |
| `backend/agents/merge_manager.py` | Modify | Call `record_card_end` at the three terminal-state sites + on `reset` (mark `stopped`) |
| `backend/agents/input_manager.py` | Modify | `send_to_downstream` accepts optional `run_id`; threads to `route_to_downstream` |
| `backend/main.py` | Modify | Trigger wiring at four sites (input send, webhook, dashboard invoke, ws agent send); two new REST routes; WS broadcast on `run:update`; startup restore |
| `scripts/verify_workflow_run.py` | Create | Async script: simulate trigger → routing → terminal events → run close; assert schema + ref counting + stale sweep |
| `frontend/src/shared/state/runsSlice.ts` | Create | Mirrors `mergeCardsSlice` structure + `activeRunId` for canvas overlay |
| `frontend/src/shared/state/store.ts` | Modify | Wire `runsReducer` |
| `frontend/src/shared/ws/WebSocketManager.ts` | Modify | Dispatch `run:update` |
| `frontend/src/app/pages/Canvas/RunsDrawer.tsx` | Create | Right-side drawer: list with pagination + detail panel |
| `frontend/src/app/pages/Canvas/Toolbar.tsx` | Modify | Runs button between clock and cog |
| `frontend/src/app/pages/Canvas/Canvas.tsx` | Modify | Mount drawer; tap into adapter when `activeRunId` is set |
| `frontend/src/app/pages/Canvas/xyflow/adapters.ts` | Modify | When active run is selected, populate `data.runStatus`, `data.runCost`, `data.runError`, `data.notInRun` from `card_runs`; mark edges in `routes_taken` solid |
| `frontend/src/app/pages/Canvas/AgentCard.tsx`, `GateCardComponent.tsx`, `DialogueCardComponent.tsx`, `MergeCardComponent.tsx`, `ViewCardComponent.tsx`, `InputCardComponent.tsx` | Modify | Read `data.runStatus`/`notInRun`; render in overlay mode (status reflects run, dimmed if not in run, edit disabled) |

---

## Task 1: Backend — `CardRunRecord` + `WorkflowRun` models + storage

**Files:**
- Modify: `backend/agents/models.py` (insert after `MergeCard`)
- Modify: `backend/sessions/store.py` (add helpers; update import)

- [ ] **Step 1: Add the models**

In `backend/agents/models.py`, find the end of the `MergeCard` class (around line 121) and insert immediately after:

```python
class CardRunRecord(BaseModel):
    card_id: str
    session_id: Optional[str] = None
    card_type: Literal["agent", "gate", "dialogue", "merge", "view", "input"]
    card_name: str
    status: Literal["running", "completed", "error", "stopped"] = "running"
    started_at: float
    ended_at: Optional[float] = None
    cost_usd: float = 0.0
    tokens: int = 0
    routes_taken: list[str] = Field(default_factory=list)
    error_text: Optional[str] = None


class WorkflowRun(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    dashboard_id: str
    trigger: Literal["input", "webhook", "manual"]
    trigger_card_id: str
    trigger_card_name: str
    started_at: float = Field(default_factory=lambda: datetime.now().timestamp())
    ended_at: Optional[float] = None
    status: Literal["running", "completed", "error", "interrupted"] = "running"
    card_runs: list[CardRunRecord] = Field(default_factory=list)
    total_cost_usd: float = 0.0
    total_tokens: int = 0
```

All used types (`BaseModel`, `Field`, `Literal`, `Optional`, `uuid4`, `datetime`) are already imported.

- [ ] **Step 2: Add storage helpers**

In `backend/sessions/store.py`:

(a) Update the import line at top (currently includes `MergeCard`). Add `WorkflowRun`:

```python
from backend.agents.models import AgentSession, CardGroup, CardPosition, Connection, DialogueCard, GateCard, InputCard, MergeCard, ViewCard, WorkflowRun
```

(b) Add helpers after the merge-card helpers (which end around line 216 with `delete_merge_card_file`):

```python
def _runs_dir() -> Path:
    d = _data_dir() / "runs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_workflow_run(run: WorkflowRun) -> None:
    path = _runs_dir() / f"{run.id}.json"
    path.write_text(run.model_dump_json(indent=2))


def load_workflow_run(run_id: str) -> WorkflowRun | None:
    path = _runs_dir() / f"{run_id}.json"
    if not path.exists():
        return None
    try:
        return WorkflowRun.model_validate_json(path.read_text())
    except Exception:
        return None


def load_all_workflow_runs() -> list[WorkflowRun]:
    runs: list[WorkflowRun] = []
    for path in _runs_dir().glob("*.json"):
        try:
            runs.append(WorkflowRun.model_validate_json(path.read_text()))
        except Exception:
            continue
    return runs


def load_runs_for_dashboard(dashboard_id: str, limit: int = 50, offset: int = 0) -> list[WorkflowRun]:
    """Returns runs for a dashboard, newest-first, paginated."""
    runs = [r for r in load_all_workflow_runs() if r.dashboard_id == dashboard_id]
    runs.sort(key=lambda r: r.started_at, reverse=True)
    return runs[offset : offset + limit]


def delete_workflow_run_file(run_id: str) -> None:
    path = _runs_dir() / f"{run_id}.json"
    if path.exists():
        path.unlink()
```

- [ ] **Step 3: Sanity check**

```bash
cd /home/barrulus/dev/agentcanvas && python -c "
from backend.agents.models import WorkflowRun, CardRunRecord
from backend.sessions.store import save_workflow_run, load_workflow_run, load_runs_for_dashboard, delete_workflow_run_file
r = WorkflowRun(dashboard_id='d1', trigger='manual', trigger_card_id='c1', trigger_card_name='Card1')
save_workflow_run(r)
loaded = load_workflow_run(r.id)
assert loaded is not None and loaded.dashboard_id == 'd1' and loaded.status == 'running'
all_for_d = load_runs_for_dashboard('d1')
assert any(x.id == r.id for x in all_for_d)
delete_workflow_run_file(r.id)
assert load_workflow_run(r.id) is None
print('ok')
"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add backend/agents/models.py backend/sessions/store.py
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: WorkflowRun + CardRunRecord models + storage helpers"
```

NO `Co-Authored-By` line.

---

## Task 2: Backend — `RunManager` singleton

**Files:**
- Create: `backend/agents/run_manager.py`

- [ ] **Step 1: Create the file**

Write `/home/barrulus/dev/agentcanvas/backend/agents/run_manager.py` with EXACTLY this content:

```python
"""WorkflowRun manager — tracks per-trigger atomic runs with reference counting."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import TYPE_CHECKING

from backend.agents.models import CardRunRecord, WorkflowRun
from backend.agents.ws_manager import ws_manager
from backend.sessions.store import (
    delete_workflow_run_file,
    load_all_workflow_runs,
    load_runs_for_dashboard,
    load_workflow_run,
    save_workflow_run,
)

if TYPE_CHECKING:
    from backend.agents.agent_manager import AgentManager

logger = logging.getLogger(__name__)

STALE_RUN_THRESHOLD_SECONDS = 60 * 60         # 1 hour
SWEEP_INTERVAL_SECONDS = 5 * 60               # 5 minutes


class RunManager:
    def __init__(self) -> None:
        self.runs: dict[str, WorkflowRun] = {}
        self._in_flight: dict[str, set[str]] = {}     # run_id → set of card_ids still running
        self._card_to_run: dict[str, str] = {}        # card_id → run_id (one run per card at a time)
        self._sweep_task: asyncio.Task | None = None

    # --- Lifecycle ---

    def restore_runs(self) -> None:
        for run in load_all_workflow_runs():
            if run.status == "running":
                # Server crashed mid-run; close as interrupted.
                run.status = "interrupted"
                run.ended_at = run.ended_at or run.started_at
                save_workflow_run(run)
            self.runs[run.id] = run
        logger.info("Restored %d workflow runs (any 'running' marked 'interrupted')", len(self.runs))

    def start_sweeper(self) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # called outside an event loop; sweeper will start on first await
        if self._sweep_task is None or self._sweep_task.done():
            self._sweep_task = loop.create_task(self._sweep_stale_runs())

    async def _sweep_stale_runs(self) -> None:
        while True:
            try:
                await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                return
            now = datetime.now().timestamp()
            for run in list(self.runs.values()):
                if run.status != "running":
                    continue
                if now - run.started_at > STALE_RUN_THRESHOLD_SECONDS:
                    logger.warning("RunManager: sweeping stale run %s (started %.0fs ago)", run.id, now - run.started_at)
                    self._force_close(run, status="interrupted")

    # --- Public API ---

    def start_run(
        self,
        dashboard_id: str,
        trigger: str,
        trigger_card_id: str,
        agent_mgr: "AgentManager",
    ) -> WorkflowRun:
        from backend.agents.agent_manager import _resolve_card_name
        name = _resolve_card_name(trigger_card_id, agent_mgr) or trigger_card_id
        run = WorkflowRun(
            dashboard_id=dashboard_id,
            trigger=trigger,  # type: ignore[arg-type]
            trigger_card_id=trigger_card_id,
            trigger_card_name=name,
        )
        self.runs[run.id] = run
        self._in_flight[run.id] = set()
        save_workflow_run(run)
        # Don't broadcast yet — record_card_start for the trigger card fires immediately after.
        self.start_sweeper()
        return run

    def record_card_start(
        self,
        run_id: str,
        card_id: str,
        agent_mgr: "AgentManager",
    ) -> None:
        run = self.runs.get(run_id)
        if not run:
            return
        # If the card is already in this run (re-entry), don't reset started_at.
        existing = next((cr for cr in run.card_runs if cr.card_id == card_id), None)
        if existing is None:
            from backend.agents.agent_manager import _resolve_card_name
            card_type = self._resolve_card_type(card_id, agent_mgr)
            if card_type is None:
                logger.warning("RunManager: cannot resolve card type for %s in run %s", card_id, run_id)
                return
            name = _resolve_card_name(card_id, agent_mgr) or card_id
            session_id: str | None = card_id if card_type == "agent" else None
            cr = CardRunRecord(
                card_id=card_id,
                session_id=session_id,
                card_type=card_type,  # type: ignore[arg-type]
                card_name=name,
                status="running",
                started_at=datetime.now().timestamp(),
            )
            run.card_runs.append(cr)
        else:
            # Re-entry of an already-tracked card: only flip status back to running if it was terminal.
            if existing.status != "running":
                existing.status = "running"
                existing.ended_at = None

        self._in_flight[run_id].add(card_id)
        # Bind card to this run so terminal-state hooks can find it.
        self._card_to_run[card_id] = run_id
        save_workflow_run(run)
        asyncio.create_task(self._broadcast(run))

    def record_card_end(
        self,
        card_id: str,
        status: str,
        cost_usd: float = 0.0,
        tokens: int = 0,
        error_text: str | None = None,
    ) -> None:
        run_id = self._card_to_run.get(card_id)
        if not run_id:
            return  # card not part of any run
        run = self.runs.get(run_id)
        if not run:
            return
        cr = next((c for c in run.card_runs if c.card_id == card_id), None)
        if cr is None:
            return
        cr.status = status  # type: ignore[assignment]
        cr.ended_at = datetime.now().timestamp()
        cr.cost_usd += cost_usd
        cr.tokens += tokens
        if error_text:
            cr.error_text = error_text
        run.total_cost_usd += cost_usd
        run.total_tokens += tokens

        self._in_flight[run_id].discard(card_id)
        self._card_to_run.pop(card_id, None)

        save_workflow_run(run)

        if not self._in_flight[run_id]:
            self._close_run(run)
        else:
            asyncio.create_task(self._broadcast(run))

    def record_route(self, run_id: str, conn_id: str, source_card_id: str) -> None:
        run = self.runs.get(run_id)
        if not run:
            return
        cr = next((c for c in run.card_runs if c.card_id == source_card_id), None)
        if cr is None:
            return
        if conn_id not in cr.routes_taken:
            cr.routes_taken.append(conn_id)
            save_workflow_run(run)

    def get_run(self, run_id: str) -> WorkflowRun | None:
        return self.runs.get(run_id)

    def list_runs(self, dashboard_id: str, limit: int = 50, offset: int = 0) -> list[WorkflowRun]:
        return load_runs_for_dashboard(dashboard_id, limit=limit, offset=offset)

    def card_to_run_id(self, card_id: str) -> str | None:
        return self._card_to_run.get(card_id)

    # --- Internal ---

    def _close_run(self, run: WorkflowRun) -> None:
        run.ended_at = datetime.now().timestamp()
        any_error = any(cr.status == "error" for cr in run.card_runs)
        run.status = "error" if any_error else "completed"
        save_workflow_run(run)
        self._in_flight.pop(run.id, None)
        asyncio.create_task(self._broadcast(run))

    def _force_close(self, run: WorkflowRun, status: str) -> None:
        run.status = status  # type: ignore[assignment]
        run.ended_at = datetime.now().timestamp()
        save_workflow_run(run)
        # Forget any card bindings.
        for card_id in list(self._card_to_run.keys()):
            if self._card_to_run[card_id] == run.id:
                self._card_to_run.pop(card_id, None)
        self._in_flight.pop(run.id, None)
        asyncio.create_task(self._broadcast(run))

    def _resolve_card_type(self, card_id: str, agent_mgr: "AgentManager") -> str | None:
        if agent_mgr.sessions.get(card_id):
            return "agent"
        from backend.agents.gate_manager import gate_manager
        if gate_manager.get_gate_card(card_id):
            return "gate"
        from backend.agents.dialogue_manager import dialogue_manager
        if dialogue_manager.get_dialogue_card(card_id):
            return "dialogue"
        from backend.agents.merge_manager import merge_manager
        if merge_manager.get_merge_card(card_id):
            return "merge"
        from backend.sessions.store import load_view_card, load_input_card
        if load_view_card(card_id):
            return "view"
        if load_input_card(card_id):
            return "input"
        return None

    async def _broadcast(self, run: WorkflowRun) -> None:
        await ws_manager.broadcast_dashboard(
            "run:update",
            {"run_id": run.id, "run": run.model_dump()},
        )


run_manager = RunManager()
```

- [ ] **Step 2: Sanity check**

```bash
cd /home/barrulus/dev/agentcanvas && python -c "
from backend.agents.run_manager import run_manager, RunManager
assert isinstance(run_manager, RunManager)
print('ok')
"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add backend/agents/run_manager.py
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: RunManager singleton with ref counting + stale sweep"
```

NO `Co-Authored-By` line.

---

## Task 3: Backend — thread `run_id` through routing, hook `record_card_start` + `record_route`

**Files:**
- Modify: `backend/agents/agent_manager.py`
- Modify: `backend/agents/input_manager.py` (light — pass-through `run_id`)

- [ ] **Step 1: Add `run_id` parameter to `route_to_downstream`**

In `backend/agents/agent_manager.py`, find the `route_to_downstream` signature (around line 128):

```python
async def route_to_downstream(
    from_card_id: str,
    content: str,
    dashboard_id: str,
    agent_mgr: "AgentManager",
    visited: set[str] | None = None,
) -> None:
```

Change to:

```python
async def route_to_downstream(
    from_card_id: str,
    content: str,
    dashboard_id: str,
    agent_mgr: "AgentManager",
    visited: set[str] | None = None,
    run_id: str | None = None,
) -> None:
```

- [ ] **Step 2: Recurse-through `run_id` inside `route_to_downstream`**

Find the recursive `route_to_downstream(...)` call inside `_route_single` (when a target dispatches further routing — for instance after gate resolution or merge emission, which call `route_to_downstream` themselves with their own card_id as source). For now, the only **direct** recursion inside `_route_single` is for non-target dispatches; check carefully.

Inside `_route_single`, find the agent-target branch (around line 296-300). After `await agent_mgr.send_message(target_id, routed_text)`, no recursion. But for gate/dialogue/merge/view branches, the dispatched manager calls `route_to_downstream` from within its own emit path — those internal calls receive `run_id` via `_card_to_run` lookup at call time (RunManager already has it bound).

For gate's `_resolve` (in `gate_manager.py`), find the `route_to_downstream(card_id, card.resolved_output, card.dashboard_id, agent_manager)` call and add `run_id=run_manager.card_to_run_id(card_id)`:

```python
await route_to_downstream(
    card_id, card.resolved_output, card.dashboard_id, agent_manager,
    run_id=run_manager.card_to_run_id(card_id),
)
```

For merge's `_emit` (in `merge_manager.py`), do the same on its `route_to_downstream` call (around line 175):

```python
await route_to_downstream(
    card_id, rendered, card.dashboard_id, agent_mgr,
    run_id=run_manager.card_to_run_id(card_id),
)
```

For dialogue's terminal-state route call (search `dialogue_manager.py` for `route_to_downstream`), do the same.

For agent_manager's own `_route_output` (which routes when an agent completes — around line 988), do the same.

In every case, import `run_manager` at function scope inside the method to avoid cyclic imports:

```python
from backend.agents.run_manager import run_manager
```

- [ ] **Step 3: Hook `record_card_start` + `record_route` inside `_route_single`**

In `_route_single` (`agent_manager.py` around line 271+), find each of the five target-branches (agent / gate / dialogue / merge / view). After the routing decision is made and BEFORE the dispatch, add:

```python
if run_id:
    from backend.agents.run_manager import run_manager
    run_manager.record_card_start(run_id, target_id, agent_mgr)
    run_manager.record_route(run_id, conn.id, from_card_id)
```

Exception: for the **view-card** branch, the view card "running" lifecycle is instant (it just stores content). After `save_view_card`/broadcast, immediately call `record_card_end(target_id, status='completed')`:

```python
if run_id:
    run_manager.record_card_end(target_id, status="completed")
```

Same for the input card (if any input-card branch exists in `_route_single` — usually inputs don't receive routes, only emit them, but check). If input is a terminal target, treat the same as view.

- [ ] **Step 4: Pass `run_id` from `input_manager.send_to_downstream`**

In `backend/agents/input_manager.py`, find `send_to_downstream`. Add an optional `run_id` parameter and pass it to `route_to_downstream`:

```python
async def send_to_downstream(self, card_id: str, content: str, run_id: str | None = None) -> None:
    ...
    await route_to_downstream(card_id, content, dashboard_id, agent_manager, run_id=run_id)
```

If the file watcher / scheduler also calls `send_to_downstream`, leave them passing no `run_id` for now (they're orthogonal triggers).

- [ ] **Step 5: Sanity check + Phase E regression**

```bash
cd /home/barrulus/dev/agentcanvas && python -c "
from backend.agents.agent_manager import route_to_downstream, _resolve_card_name, _apply_template_with_slots
from backend.agents.run_manager import run_manager
print('imports ok')
"
cd /home/barrulus/dev/agentcanvas && python -m scripts.verify_expression_language
cd /home/barrulus/dev/agentcanvas && python -m scripts.verify_merge_card
```

Both verification scripts must still pass (no regression from threading the new param).

- [ ] **Step 6: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add backend/agents/agent_manager.py backend/agents/input_manager.py backend/agents/gate_manager.py backend/agents/merge_manager.py backend/agents/dialogue_manager.py
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: thread run_id through route_to_downstream + record card_start/route hooks"
```

NO `Co-Authored-By` line.

---

## Task 4: Backend — terminal-state hooks across all card managers

**Files:**
- Modify: `backend/agents/agent_manager.py`
- Modify: `backend/agents/gate_manager.py`
- Modify: `backend/agents/dialogue_manager.py`
- Modify: `backend/agents/merge_manager.py`

Add `run_manager.record_card_end(...)` immediately after each `card.status = ...` / `session.status = ...` assignment that lands on a terminal value.

- [ ] **Step 1: Agent terminal sites**

In `backend/agents/agent_manager.py`, the terminal-state assignments are at:
- `:675` — `session.status = "error"` (turn-handler failure)
- `:677` — `session.status = "completed"` (normal stop)
- `:679` — `session.status = "completed"` (alternate normal stop)
- `:683` — `session.status = "error"` (outer exception)
- `:721` — `session.status = "stopped"` (stop_session)
- `:1110` — `session.status = "stopped"` (fallback)

After EACH of these assignments, insert:

```python
                from backend.agents.run_manager import run_manager
                run_manager.record_card_end(
                    session.id,
                    status=session.status,
                    cost_usd=session.cost_usd_delta if hasattr(session, 'cost_usd_delta') else 0.0,
                    tokens=session.tokens_delta if hasattr(session, 'tokens_delta') else 0,
                    error_text=getattr(session, 'last_error', None),
                )
```

(Match the indentation of the surrounding code at each site — it varies. The `session.cost_usd_delta` / `tokens_delta` fallback to 0 if the session doesn't track per-turn deltas. The `last_error` is similarly best-effort.)

If the session model doesn't expose `cost_usd_delta` / `tokens_delta`, simply pass `0` for both — totals will be wrong but the run will still close correctly. Improvement candidate for Phase F.

- [ ] **Step 2: Gate terminal sites**

In `backend/agents/gate_manager.py`:
- `:103` — `card.status = "error"` (missing provider)
- `:154` — `card.status = "completed"` (resolution success)
- `:169` — `card.status = "error"` (resolution exception)

After each, insert (function-scoped import of `run_manager`):

```python
from backend.agents.run_manager import run_manager
run_manager.record_card_end(
    card.id,
    status=card.status,
    error_text="Gate resolution failed" if card.status == "error" else None,
)
```

- [ ] **Step 3: Dialogue terminal sites**

In `backend/agents/dialogue_manager.py`:
- `:120` — `card.status = "error"` (init failure)
- `:128` — `card.status = "error"` (orchestrator missing)
- `:231` — `card.status = "completed"` (dialogue ends)
- `:242` — `card.status = "error"` (worker error)

After each, insert:

```python
from backend.agents.run_manager import run_manager
run_manager.record_card_end(
    card.id,
    status=card.status,
    error_text=card.error_text if hasattr(card, 'error_text') else None,
)
```

- [ ] **Step 4: Merge terminal sites + reset**

In `backend/agents/merge_manager.py`:
- `:152` — `card.status = "error"` (empty template)
- `:164` — `card.status = "completed"` (emit success)
- `:197` — `card.status = "error"` (timeout)

After each, insert:

```python
from backend.agents.run_manager import run_manager
run_manager.record_card_end(
    card_id,
    status=card.status,
    error_text=card.error_text,
)
```

In `reset()` (around line 207), after `card.status = "idle"`, also fire:

```python
from backend.agents.run_manager import run_manager
run_manager.record_card_end(card_id, status="stopped")
```

This handles the "user reset a merge mid-run" case — the card-run closes as `stopped` and the run's ref count drops.

- [ ] **Step 5: Sanity check**

```bash
cd /home/barrulus/dev/agentcanvas && python -c "
from backend.agents.agent_manager import agent_manager
from backend.agents.gate_manager import gate_manager
from backend.agents.dialogue_manager import dialogue_manager
from backend.agents.merge_manager import merge_manager
print('all managers import ok')
"
cd /home/barrulus/dev/agentcanvas && python -m scripts.verify_expression_language
cd /home/barrulus/dev/agentcanvas && python -m scripts.verify_merge_card
```

Both verification scripts must still pass — no regression.

- [ ] **Step 6: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add backend/agents/agent_manager.py backend/agents/gate_manager.py backend/agents/dialogue_manager.py backend/agents/merge_manager.py
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: hook record_card_end at all terminal-state sites"
```

NO `Co-Authored-By` line.

---

## Task 5: Backend — REST routes + WS broadcast + startup restore + trigger wiring

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Startup restore**

Find the existing `merge_manager.restore_merge_cards()` line (around line 29). Add immediately after:

```python
    from backend.agents.run_manager import run_manager
    run_manager.restore_runs()
    run_manager.start_sweeper()
```

- [ ] **Step 2: Add REST routes**

After the merge-card routes (around line 491+), insert:

```python
# --- Workflow Runs ---


@app.get("/api/dashboards/{dashboard_id}/runs")
async def list_dashboard_runs(dashboard_id: str, limit: int = 50, offset: int = 0):
    from backend.agents.run_manager import run_manager
    runs = run_manager.list_runs(dashboard_id, limit=limit, offset=offset)
    return {"runs": [r.model_dump() for r in runs], "limit": limit, "offset": offset}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    from backend.agents.run_manager import run_manager
    run = run_manager.get_run(run_id)
    if not run:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return run.model_dump()
```

- [ ] **Step 3: Wire trigger sites**

**Site 1 — Input card manual send** (`backend/main.py:606`):

Currently:
```python
@app.post("/api/input-cards/{card_id}/send")
async def send_input_card(card_id: str, request: Request):
    body = await request.json()
    content = body.get("content", "")
    if not content:
        return JSONResponse({"error": "No content"}, status_code=400)
    await input_manager.send_to_downstream(card_id, content)
    return {"ok": True}
```

Change to:
```python
@app.post("/api/input-cards/{card_id}/send")
async def send_input_card(card_id: str, request: Request):
    body = await request.json()
    content = body.get("content", "")
    if not content:
        return JSONResponse({"error": "No content"}, status_code=400)
    card = input_manager.get_input_card(card_id)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    from backend.agents.run_manager import run_manager
    run = run_manager.start_run(card.dashboard_id, "input", card_id, agent_manager)
    run_manager.record_card_start(run.id, card_id, agent_manager)
    run_manager.record_card_end(card_id, status="completed")  # input cards complete on emission
    await input_manager.send_to_downstream(card_id, content, run_id=run.id)
    return {"ok": True, "run_id": run.id}
```

**Site 2 — Webhook input** (`backend/main.py:617`):

Same pattern: build run with `trigger="webhook"`, fire start/end on the input card, pass `run_id` to `send_to_downstream`.

**Site 3 — Dashboard invoke** (`backend/main.py:640`):

Same pattern with `trigger="webhook"` and `trigger_card_id=input_card_id`.

**Site 4 — Manual agent send via WS** (`backend/main.py:1177` and `:1204`):

Change:
```python
if event == "agent:send_message":
    await agent_manager.send_message(...)
```

to:
```python
if event == "agent:send_message":
    session = agent_manager.get_session(session_id)
    if session and session.dashboard_id:
        from backend.agents.run_manager import run_manager
        run = run_manager.start_run(session.dashboard_id, "manual", session_id, agent_manager)
        run_manager.record_card_start(run.id, session_id, agent_manager)
        # Bind so terminal-state hooks find this run when the agent finishes
        # (record_card_start already binds via _card_to_run)
    await agent_manager.send_message(...)
```

(The agent's terminal-state hooks from Task 4 will close the card-run when the agent finishes, which closes the run.)

- [ ] **Step 4: Sanity check + Phase E + MergeCard regression**

```bash
cd /home/barrulus/dev/agentcanvas && python -c "
from backend.main import app
routes = [getattr(r, 'path', None) for r in app.routes]
required = ['/api/dashboards/{dashboard_id}/runs', '/api/runs/{run_id}']
for r in required:
    assert r in routes, f'missing {r}'
print('routes ok')
"
cd /home/barrulus/dev/agentcanvas && python -m scripts.verify_expression_language
cd /home/barrulus/dev/agentcanvas && python -m scripts.verify_merge_card
```

All must pass.

- [ ] **Step 5: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add backend/main.py
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: REST routes, startup restore, and trigger wiring"
```

NO `Co-Authored-By` line.

---

## Task 6: Backend — verification script

**Files:**
- Create: `scripts/verify_workflow_run.py`

- [ ] **Step 1: Create the script**

Write a script that:
1. Mocks `_resolve_card_name` and `_resolve_card_type` to return synthetic agent cards.
2. Calls `run_manager.start_run(...)` → asserts run created, status=running.
3. Calls `record_card_start(run_id, card_id_a, ...)` → asserts in-flight set has 1 entry.
4. Calls `record_card_start(run_id, card_id_b, ...)` → asserts in-flight = 2.
5. Calls `record_card_end(card_id_a, status="completed", cost_usd=0.05, tokens=100)` → asserts run still running, in-flight = 1.
6. Calls `record_route(run_id, "conn1", card_id_a)` → asserts routes_taken contains "conn1".
7. Calls `record_card_end(card_id_b, status="completed")` → asserts run closed (status="completed", ended_at set, in-flight gone).
8. Manually triggers `_force_close` on a fresh run → asserts status="interrupted".
9. Re-entry test: create fresh run + record_card_start(A) + record_card_end(A, error) + record_card_start(A) again → asserts ONE CardRunRecord with started_at unchanged from first entry, status now back to "running".

Reference `scripts/verify_merge_card.py` for the test scaffold (mocked `agent_mgr.sessions`, `unittest.mock.patch` for the resolver helpers, asyncio.run wrapper).

Script must end with `PASS (0 failure(s))` and exit 0.

- [ ] **Step 2: Run it**

```bash
cd /home/barrulus/dev/agentcanvas && python -m scripts.verify_workflow_run
```

Expected: all `[PASS]`, final line `PASS (0 failure(s))`.

- [ ] **Step 3: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add scripts/verify_workflow_run.py
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: verification script for RunManager flow"
```

NO `Co-Authored-By` line.

---

## Task 7: Frontend — `runsSlice` + store + WS dispatch

**Files:**
- Create: `frontend/src/shared/state/runsSlice.ts`
- Modify: `frontend/src/shared/state/store.ts`
- Modify: `frontend/src/shared/ws/WebSocketManager.ts`

- [ ] **Step 1: Create the slice**

```ts
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export interface CardRunRecord {
  card_id: string
  session_id: string | null
  card_type: 'agent' | 'gate' | 'dialogue' | 'merge' | 'view' | 'input'
  card_name: string
  status: 'running' | 'completed' | 'error' | 'stopped'
  started_at: number
  ended_at: number | null
  cost_usd: number
  tokens: number
  routes_taken: string[]
  error_text: string | null
}

export interface WorkflowRun {
  id: string
  dashboard_id: string
  trigger: 'input' | 'webhook' | 'manual'
  trigger_card_id: string
  trigger_card_name: string
  started_at: number
  ended_at: number | null
  status: 'running' | 'completed' | 'error' | 'interrupted'
  card_runs: CardRunRecord[]
  total_cost_usd: number
  total_tokens: number
}

interface RunsState {
  byId: Record<string, WorkflowRun>
  orderByDashboard: Record<string, string[]>   // dashboard_id → [run_id...] newest first
  activeRunId: string | null                    // null = live canvas
}

const initialState: RunsState = { byId: {}, orderByDashboard: {}, activeRunId: null }

export const fetchRuns = createAsyncThunk(
  'runs/fetch',
  async ({ dashboardId, limit = 50, offset = 0 }: { dashboardId: string; limit?: number; offset?: number }) => {
    const res = await fetch(`/api/dashboards/${dashboardId}/runs?limit=${limit}&offset=${offset}`)
    const data = await res.json()
    return { dashboardId, runs: data.runs as WorkflowRun[], offset }
  },
)

export const fetchRun = createAsyncThunk('runs/fetchOne', async (runId: string) => {
  const res = await fetch(`/api/runs/${runId}`)
  return await res.json() as WorkflowRun
})

const runsSlice = createSlice({
  name: 'runs',
  initialState,
  reducers: {
    setRun(state, action: PayloadAction<WorkflowRun>) {
      const run = action.payload
      state.byId[run.id] = run
      const list = state.orderByDashboard[run.dashboard_id] || []
      if (!list.includes(run.id)) {
        state.orderByDashboard[run.dashboard_id] = [run.id, ...list]
      }
    },
    setActiveRun(state, action: PayloadAction<string | null>) {
      state.activeRunId = action.payload
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchRuns.fulfilled, (state, action) => {
      const { dashboardId, runs, offset } = action.payload
      for (const r of runs) state.byId[r.id] = r
      const ids = runs.map(r => r.id)
      const existing = state.orderByDashboard[dashboardId] || []
      state.orderByDashboard[dashboardId] = offset === 0
        ? ids
        : [...existing, ...ids.filter(id => !existing.includes(id))]
    })
    builder.addCase(fetchRun.fulfilled, (state, action) => {
      state.byId[action.payload.id] = action.payload
    })
  },
})

export const { setRun, setActiveRun } = runsSlice.actions
export const runsReducer = runsSlice.reducer
```

- [ ] **Step 2: Wire into store**

In `frontend/src/shared/state/store.ts`, add:

```ts
import { runsReducer } from './runsSlice'
```

Add `runs: runsReducer,` to the `reducer` object next to `mergeCards`.

- [ ] **Step 3: Wire WebSocket**

In `frontend/src/shared/ws/WebSocketManager.ts`:

(a) Add import:
```ts
import { setRun } from '../state/runsSlice'
```

(b) Add the case immediately after `merge_card:update`:

```ts
      case 'run:update':
        if (data.run) {
          store.dispatch(setRun(data.run))
        }
        break
```

- [ ] **Step 4: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npx tsc --noEmit 2>&1 | tail -5
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add frontend/src/shared/state/runsSlice.ts frontend/src/shared/state/store.ts frontend/src/shared/ws/WebSocketManager.ts
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: runs Redux slice + store + WS dispatch"
```

NO `Co-Authored-By` line.

---

## Task 8: Frontend — `RunsDrawer` component

**Files:**
- Create: `frontend/src/app/pages/Canvas/RunsDrawer.tsx`

- [ ] **Step 1: Read reference**

Read `frontend/src/app/pages/History/History.tsx` first to mirror its right-side drawer styling and layout.

- [ ] **Step 2: Create the component**

The drawer takes `open: boolean`, `onClose: () => void`, `dashboardId: string`. On mount and on dashboard change, dispatch `fetchRuns({ dashboardId })`. List runs from `runs.byId` filtered by `runs.orderByDashboard[dashboardId]`.

Each row:
- Status dot (`#66bb6a` completed, `#ef5350` error, `#4fc3f7` running, `#888` interrupted)
- Display name: live lookup first via `agentSession.name` / `mergeCard.name` / `gateCard.name` / `dialogueCard.name` / `viewCard.name` / `inputCard.name` keyed by `trigger_card_id`. Fallback to `trigger_card_name` snapshot if not found. Append `· HH:MM:SS` (`new Date(run.started_at * 1000).toLocaleTimeString()`).
- Trigger label (`webhook` / `input` / `manual`).
- Duration (`run.ended_at ? formatDuration(run.ended_at - run.started_at) : '—'`).
- Total cost (`$0.0123` or `—` if 0).

Row click: `dispatch(setActiveRun(run.id))`. Same row click again clears: `dispatch(setActiveRun(null))`.

When a row is selected (active or just-clicked), expand inline:
- `Cards (N):` list of `card_runs[*]` with status dot, name, type, duration, cost, error_text if any.
- `[ Replay (Phase F) ]` button — disabled, `title="Available after card-definition split"`.
- `[ Return to live ]` button — dispatches `setActiveRun(null)`.

Footer: `[ Load more ]` button — dispatches `fetchRuns({ dashboardId, offset: orderByDashboard[dashboardId].length })`. Hide if last fetch returned fewer than 50.

Use right-side drawer styling from `History.tsx`. Keep the file under ~300 lines.

- [ ] **Step 3: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npx tsc --noEmit 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add frontend/src/app/pages/Canvas/RunsDrawer.tsx
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: RunsDrawer component"
```

NO `Co-Authored-By` line.

---

## Task 9: Frontend — Toolbar Runs button + drawer mounting

**Files:**
- Modify: `frontend/src/app/pages/Canvas/Toolbar.tsx`
- Modify: `frontend/src/app/pages/Canvas/Canvas.tsx` (or wherever the History drawer mounts)

- [ ] **Step 1: Add toolbar button**

In `Toolbar.tsx`, find the existing clock button (history). Add a similar icon button immediately next to it (e.g. a stack/list icon, or use text `Runs`). On click, toggle `showRunsDrawer` state lifted to the parent (or via a new `onOpenRuns` prop, mirroring the existing `onOpenHistory` / `onOpenSettings` props).

- [ ] **Step 2: Mount the drawer**

In the component that owns the existing History drawer (read `App.tsx` or wherever `<History/>` is rendered conditionally), add a parallel render:

```tsx
{showRuns && currentDashboardId && (
  <RunsDrawer
    open={showRuns}
    onClose={() => setShowRuns(false)}
    dashboardId={currentDashboardId}
  />
)}
```

- [ ] **Step 3: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add frontend/src/app/pages/Canvas/Toolbar.tsx frontend/src/app/App.tsx
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: Toolbar Runs button + drawer mount"
```

NO `Co-Authored-By` line.

---

## Task 10: Frontend — canvas overlay adapter changes

**Files:**
- Modify: `frontend/src/app/pages/Canvas/xyflow/adapters.ts`

- [ ] **Step 1: Extend `CardNodeData` and `AgentEdgeData`**

```ts
export type CardNodeData = {
  cardType: 'agent' | 'view' | 'input' | 'gate' | 'dialogue' | 'merge'
  collapsed: boolean
  zOrder: number
  groupId?: string
  // run overlay
  runStatus?: 'running' | 'completed' | 'error' | 'stopped'
  runCost?: number
  runTokens?: number
  runError?: string | null
  notInRun?: boolean
}

export type AgentEdgeData = {
  condition?: string
  output_schema?: Record<string, unknown>
  transform?: string
  gate_rule?: string
  blockedReason?: string
  // run overlay
  firedInRun?: boolean
}
```

- [ ] **Step 2: Update `selectNodes` / `selectEdges` to apply overlay**

Have them accept the active run as a parameter (or read from RootState directly via a memoized selector). When `activeRun` is set:

- For each card, look up its `CardRunRecord` in `activeRun.card_runs` by `card_id`. If found, populate `runStatus`/`runCost`/`runTokens`/`runError`. If not found, set `notInRun = true`.
- For each edge, set `firedInRun = activeRun.card_runs.some(cr => cr.routes_taken.includes(edge.id))`.

When `activeRun` is null, leave the new fields undefined — components fall back to live state.

- [ ] **Step 3: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add frontend/src/app/pages/Canvas/xyflow/adapters.ts
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: canvas adapter populates run-overlay fields"
```

NO `Co-Authored-By` line.

---

## Task 11: Frontend — card-component overlay rendering

**Files:**
- Modify: `frontend/src/app/pages/Canvas/AgentCard.tsx`
- Modify: `frontend/src/app/pages/Canvas/GateCardComponent.tsx`
- Modify: `frontend/src/app/pages/Canvas/DialogueCardComponent.tsx`
- Modify: `frontend/src/app/pages/Canvas/MergeCardComponent.tsx`
- Modify: `frontend/src/app/pages/Canvas/ViewCardComponent.tsx`
- Modify: `frontend/src/app/pages/Canvas/InputCardComponent.tsx`

Each component already accepts a `card: CardPosition` prop. The overlay fields live on the xyflow node data, accessible via xyflow's `useNodeData` or by having the parent wrapper pass them down. Plumb them in via a new optional prop on each component:

```tsx
type RunOverlay = {
  status?: 'running' | 'completed' | 'error' | 'stopped'
  cost?: number
  tokens?: number
  error?: string | null
  notInRun?: boolean
}

// component prop:
{ card: CardPosition; chromeless?: boolean; overlay?: RunOverlay }
```

Inside each component:
- If `overlay?.notInRun`, render the entire card at `opacity: 0.3`.
- If `overlay?.status` is set, replace the live-status border color with the run's status color.
- Disable the edit-pencil and drag handles when `overlay` is set (read-only mode).
- Hover tooltip on the node header showing duration / cost / error from overlay.

Plumb through the `xyflow/nodes.tsx` wrappers — `CardWrapper` reads node data and passes the overlay fields down.

- [ ] **Step 1-6: Apply per component (one commit per component to keep diffs small)**

For each component, make the changes above. After each, build:

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npm run build 2>&1 | tail -5
```

Commit per component:
```
git -C /home/barrulus/dev/agentcanvas commit -m "Phase C: overlay rendering on <ComponentName>"
```

If you find that all six components share an identical change pattern (border color via STATUS_COLORS, opacity via notInRun, edit-disable via overlay-set), consolidate into a single commit covering all six.

---

## Task 12: Manual smoke test

- [ ] **Step 1: Start dev stack**

```bash
cd /home/barrulus/dev/agentcanvas && ./run.sh
```

- [ ] **Step 2: Trigger a run via input card**

1. On a dashboard with at least one input card → one agent → one merge → one editor agent, send content via the input card chat.
2. Watch the WS for `run:update` events — drawer should populate immediately.
3. After all cards finish, run row in drawer shows `completed`, with all card_runs visible.

- [ ] **Step 3: Trigger a run via webhook**

Use `curl -X POST http://localhost:8000/api/dashboards/{id}/invoke -H 'Content-Type: application/json' -d '{"input_card_id":"...","output_card_id":"...","content":"hello"}'`. Verify the run appears with `trigger='webhook'`.

- [ ] **Step 4: Trigger a run via manual chat send**

Click on an agent card, type into its chat panel, send. Verify the run appears with `trigger='manual'`.

- [ ] **Step 5: Click a run → canvas overlay**

1. Click a row in the drawer.
2. Canvas dims, cards in the run show their run status (completed/error/etc), cards not in the run dimmed to 30%.
3. Edges that fired render solid; others dimmed.
4. Hovering a card shows duration/cost in tooltip.
5. Editing a card is disabled (no edit pencil; drag has no effect or is gone).

- [ ] **Step 6: Return to live**

Click the row again or the `Return to live` button. Canvas snaps back to live state, editing works again.

- [ ] **Step 7: Server restart with open run**

1. Start a long-running agent via manual send. While it's running, kill the backend (`Ctrl+C`).
2. Restart with `./run.sh`.
3. Open the drawer — the in-flight run should show as `interrupted`.

- [ ] **Step 8: Replay button**

Confirm the disabled `Replay (Phase F)` button is visible on the detail panel with the tooltip.

- [ ] **Step 9: Commit nothing — manual gate**

If anything fails, file a defect against the offending task.

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task. Schema (T1), RunManager (T2), routing thread + start hooks (T3), terminal-state hooks (T4), REST + triggers (T5), verification (T6), Redux + WS (T7), drawer (T8), drawer mount (T9), canvas adapter (T10), per-card overlay rendering (T11), smoke (T12).
- **No placeholders:** every step has the actual code or commands. The component overlay changes in Task 11 give a clear pattern; the verification script in Task 6 specifies the exact assertions to make.
- **Type consistency:** `CardRunRecord` and `WorkflowRun` shape identical between Pydantic and TypeScript. `card_id` field used as the canonical reference; `session_id` is the orthogonal session-binding field. `routes_taken: list[str]` is connection ids in both layers.
- **Cross-task references:** T2 imports `_resolve_card_name` from `agent_manager` (added back in Phase E). T2 uses `record_card_start` from T2 itself but doesn't define `_resolve_card_type` until line 156 of itself — function-scoped imports avoid the load-order issue. T3-T4 add hooks that call into RunManager; both depend on T2 being landed first.
- **Risk mitigations:** stale-run sweep covers ref-count leaks. Server-restart force-close ensures persisted `running` state never strands. The `card_to_run_id(card_id)` lookup centralizes the binding so terminal-state hooks don't need to know `run_id` ahead of time.
- **Phase F readiness:** `card_id` is canonical from day one. `card_name` snapshot survives renames/deletes. The disabled `Replay` button surfaces the gap.
