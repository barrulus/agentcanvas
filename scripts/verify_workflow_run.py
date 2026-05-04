"""Verify RunManager full lifecycle: start_run, record_card_start, record_route,
record_card_end (partial/final/error), and _force_close.

Run from repo root:  python -m scripts.verify_workflow_run
Exits non-zero on any failure.
"""
from __future__ import annotations

import asyncio
import sys
from unittest.mock import AsyncMock, patch

from backend.agents.run_manager import run_manager
from backend.sessions.store import delete_workflow_run_file


class FakeAgentMgr:
    sessions: dict = {}


async def run() -> int:
    failures = 0
    fake_mgr = FakeAgentMgr()

    name_map = {"a1": "Alice", "a2": "Bob", "t1": "Trigger"}
    type_map = {"a1": "agent", "a2": "agent", "t1": "agent"}

    with patch("backend.agents.agent_manager._resolve_card_name",
               side_effect=lambda cid, _: name_map.get(cid)), \
         patch.object(run_manager, "_resolve_card_type",
                      side_effect=lambda cid, _: type_map.get(cid)), \
         patch("backend.agents.run_manager.ws_manager.broadcast_dashboard",
               new=AsyncMock()):

        # ── Test 1: start_run ────────────────────────────────────────────────
        run = run_manager.start_run(
            dashboard_id="dash1",
            trigger="manual",
            trigger_card_id="t1",
            agent_mgr=fake_mgr,  # type: ignore[arg-type]
        )
        ok = (
            run is not None
            and run.status == "running"
            and run.id in run_manager.runs
            and run_manager._in_flight.get(run.id) == set()
        )
        print(f"[{'PASS' if ok else 'FAIL'}] start_run — creates run, persists, returns it")
        if not ok:
            print(f"    run={run!r}")
        failures += int(not ok)

        # ── Test 2: record_card_start (first call) ───────────────────────────
        run_manager.record_card_start(run.id, "a1", fake_mgr)  # type: ignore[arg-type]
        await asyncio.sleep(0)  # let create_task fire
        cr = next((c for c in run.card_runs if c.card_id == "a1"), None)
        ok = (
            cr is not None
            and cr.card_type == "agent"
            and cr.card_name == "Alice"
            and len(run.card_runs) == 1
            and run_manager._in_flight[run.id] == {"a1"}
            and run_manager._card_to_run.get("a1") == run.id
        )
        print(f"[{'PASS' if ok else 'FAIL'}] record_card_start — appends CardRunRecord, in_flight=1, _card_to_run bound")
        if not ok:
            print(f"    card_runs={run.card_runs!r} in_flight={run_manager._in_flight.get(run.id)}")
        failures += int(not ok)

        # ── Test 3: record_card_start re-entry ───────────────────────────────
        # Force the card record into a terminal state first
        assert cr is not None
        cr.status = "completed"
        run_manager.record_card_start(run.id, "a1", fake_mgr)  # type: ignore[arg-type]
        await asyncio.sleep(0)
        ok = (
            len(run.card_runs) == 1  # no duplicate
            and cr.status == "running"  # flipped back
            and run_manager._in_flight[run.id] == {"a1"}
        )
        print(f"[{'PASS' if ok else 'FAIL'}] record_card_start re-entry — no duplicate, status flipped to running")
        if not ok:
            print(f"    card_runs len={len(run.card_runs)} status={cr.status}")
        failures += int(not ok)

        # Also start a2 so we have two in-flight
        run_manager.record_card_start(run.id, "a2", fake_mgr)  # type: ignore[arg-type]
        await asyncio.sleep(0)

        # ── Test 4: record_route ─────────────────────────────────────────────
        run_manager.record_route(run.id, "conn_x", "a1")
        cr_a1 = next((c for c in run.card_runs if c.card_id == "a1"), None)
        assert cr_a1 is not None
        ok = cr_a1.routes_taken == ["conn_x"]
        # Calling again with same conn_id should not duplicate
        run_manager.record_route(run.id, "conn_x", "a1")
        ok = ok and cr_a1.routes_taken == ["conn_x"]
        print(f"[{'PASS' if ok else 'FAIL'}] record_route — appends to routes_taken, no duplicate")
        if not ok:
            print(f"    routes_taken={cr_a1.routes_taken!r}")
        failures += int(not ok)

        # ── Test 5: record_card_end (partial) ────────────────────────────────
        run_manager.record_card_end("a1", "completed", cost_usd=0.05, tokens=100)
        await asyncio.sleep(0)
        ok = (
            run.status == "running"
            and run_manager._in_flight.get(run.id) == {"a2"}
            and run.total_cost_usd == 0.05
        )
        print(f"[{'PASS' if ok else 'FAIL'}] record_card_end (partial) — run still running, in_flight=1, cost accumulated")
        if not ok:
            print(f"    status={run.status} in_flight={run_manager._in_flight.get(run.id)} cost={run.total_cost_usd}")
        failures += int(not ok)

        # ── Test 6: record_card_end (final) ──────────────────────────────────
        run_manager.record_card_end("a2", "completed", cost_usd=0.03, tokens=50)
        await asyncio.sleep(0)
        ok = (
            run.status == "completed"
            and run.ended_at is not None
            and run.id not in run_manager._in_flight
            and run.total_cost_usd == pytest_approx(0.08)
        )
        print(f"[{'PASS' if ok else 'FAIL'}] record_card_end (final) — run closed as completed, ended_at set, in_flight gone")
        if not ok:
            print(f"    status={run.status} ended_at={run.ended_at} in_flight={run_manager._in_flight.get(run.id)} cost={run.total_cost_usd}")
        failures += int(not ok)

        # ── Test 7: record_card_end with error ───────────────────────────────
        run2 = run_manager.start_run(
            dashboard_id="dash1",
            trigger="manual",
            trigger_card_id="t1",
            agent_mgr=fake_mgr,  # type: ignore[arg-type]
        )
        run_manager.record_card_start(run2.id, "a1", fake_mgr)  # type: ignore[arg-type]
        run_manager.record_card_start(run2.id, "a2", fake_mgr)  # type: ignore[arg-type]
        await asyncio.sleep(0)
        run_manager.record_card_end("a1", "error", error_text="boom")
        await asyncio.sleep(0)
        run_manager.record_card_end("a2", "completed")
        await asyncio.sleep(0)
        ok = run2.status == "error" and run2.ended_at is not None
        print(f"[{'PASS' if ok else 'FAIL'}] record_card_end with error — run closes as error when any card errored")
        if not ok:
            print(f"    status={run2.status} ended_at={run2.ended_at}")
        failures += int(not ok)

        # ── Test 8: _force_close ─────────────────────────────────────────────
        run3 = run_manager.start_run(
            dashboard_id="dash1",
            trigger="manual",
            trigger_card_id="t1",
            agent_mgr=fake_mgr,  # type: ignore[arg-type]
        )
        run_manager.record_card_start(run3.id, "a1", fake_mgr)  # type: ignore[arg-type]
        await asyncio.sleep(0)
        run_manager._force_close(run3, status="interrupted")
        await asyncio.sleep(0)
        ok = (
            run3.status == "interrupted"
            and run3.ended_at is not None
            and run3.id not in run_manager._in_flight
            and "a1" not in run_manager._card_to_run
        )
        print(f"[{'PASS' if ok else 'FAIL'}] _force_close — marks run as interrupted, cleans bindings")
        if not ok:
            print(f"    status={run3.status} ended_at={run3.ended_at} in_flight={run_manager._in_flight.get(run3.id)} card_to_run_a1={run_manager._card_to_run.get('a1')}")
        failures += int(not ok)

    # Cleanup
    for r in [run, run2, run3]:
        try:
            delete_workflow_run_file(r.id)
        except Exception:
            pass

    print(f"\n{'PASS' if failures == 0 else 'FAIL'} ({failures} failure(s))")
    return 1 if failures else 0


def pytest_approx(value: float) -> "_Approx":
    """Tiny stand-in for pytest.approx to avoid importing pytest."""
    class _Approx:
        def __init__(self, v: float, rel: float = 1e-6) -> None:
            self._v = v
            self._rel = rel

        def __eq__(self, other: object) -> bool:
            if not isinstance(other, (int, float)):
                return NotImplemented
            return abs(other - self._v) <= self._rel * max(abs(self._v), abs(other), 1e-12)

        def __repr__(self) -> str:
            return f"≈{self._v}"

    return _Approx(value)  # type: ignore[return-value]


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
