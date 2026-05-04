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
        self._in_flight: dict[str, set[str]] = {}     # run_id -> set of card_ids still running
        self._card_to_run: dict[str, str] = {}        # card_id -> run_id (one run per card at a time)
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
        # Don't broadcast yet -- record_card_start for the trigger card fires immediately after.
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
