"""Verify MergeCard end-to-end: slot fill → emit, partial → timeout → error → reset.

Run from repo root:  python -m scripts.verify_merge_card
Exits non-zero on any failure.
"""
from __future__ import annotations

import asyncio
import sys
from unittest.mock import patch

from backend.agents.agent_manager import _apply_template_with_slots
from backend.agents.merge_manager import merge_manager
from backend.agents.models import Connection
from backend.sessions.store import delete_merge_card_file


async def run() -> int:
    failures = 0

    # 1. Template renderer
    cases = [
        ("slot full",      "Hello {{slot.A}}",        {"a": "world"},               "Hello world"),
        ("slot JSON",      "{{slot.X.title}}",        {"x": '{"title":"T"}'},        "T"),
        ("slot unknown",   "{{slot.Ghost}}",          {},                            "{{slot.Ghost}}"),
        ("slot non-JSON",  "{{slot.X.f}}",            {"x": "plain"},                "{{slot.X.f}}"),
        ("nested",         "{{slot.X.a.b}}",          {"x": '{"a":{"b":"deep"}}'},   "deep"),
        ("case-insens",    "{{slot.alice}}",          {"alice": "x"},                "x"),
        ("non-slot left",  "{{output}}",              {"output": "ignored"},         "{{output}}"),
    ]
    for label, template, slots, expected in cases:
        got = _apply_template_with_slots(template, slots)
        ok = got == expected
        print(f"[{'PASS' if ok else 'FAIL'}] template — {label}")
        if not ok:
            print(f"    expected: {expected!r}")
            print(f"    got:      {got!r}")
            failures += 1

    # 2. Manager flow
    card = merge_manager.create_merge_card(
        name="TestMerge",
        template="P:{{slot.A}} | C:{{slot.B}}",
        timeout_seconds=2,
        dashboard_id="test_dash",
    )

    class FakeAgentMgr:
        sessions: dict = {}

    fake_mgr = FakeAgentMgr()

    fake_connections = [
        Connection(id="c1", from_card_id="src_a", to_card_id=card.id),
        Connection(id="c2", from_card_id="src_b", to_card_id=card.id),
    ]
    routed: list[tuple[str, str]] = []

    async def fake_route(from_id, content, dashboard_id, agent_mgr, **kwargs):
        routed.append((from_id, content))

    with patch("backend.agents.merge_manager.load_dashboard_connections", return_value=fake_connections), \
         patch("backend.agents.agent_manager._resolve_card_name", side_effect=lambda cid, _mgr: {"src_a": "A", "src_b": "B"}.get(cid)), \
         patch("backend.agents.agent_manager.route_to_downstream", side_effect=fake_route):
        # 2a. Single input → status waiting, not emitted
        await merge_manager.receive_input(card.id, "A", "alpha", fake_mgr)  # type: ignore[arg-type]
        ok = card.status == "waiting" and card.slots == {"a": "alpha"} and card.expected_slots == ["a", "b"] and not routed
        print(f"[{'PASS' if ok else 'FAIL'}] manager — single input pending")
        if not ok:
            print(f"    status={card.status} slots={card.slots} expected={card.expected_slots} routed={routed}")
            failures += 1

        # 2b. Second input → status completed, emission with rendered template
        await merge_manager.receive_input(card.id, "B", "beta", fake_mgr)  # type: ignore[arg-type]
        ok = card.status == "completed" and card.slots == {} and card.expected_slots == [] and routed == [(card.id, "P:alpha | C:beta")]
        print(f"[{'PASS' if ok else 'FAIL'}] manager — full input emits")
        if not ok:
            print(f"    status={card.status} slots={card.slots} expected={card.expected_slots} routed={routed}")
            failures += 1

        # 2c. Partial input → wait for timeout → error
        routed.clear()
        await merge_manager.receive_input(card.id, "A", "alpha2", fake_mgr)  # type: ignore[arg-type]
        await asyncio.sleep(2.5)  # wait past timeout
        ok = card.status == "error" and "Timeout" in (card.error_text or "") and "b" in (card.error_text or "") and not routed
        print(f"[{'PASS' if ok else 'FAIL'}] manager — timeout fails")
        if not ok:
            print(f"    status={card.status} error_text={card.error_text} routed={routed}")
            failures += 1

        # 2d. Reset re-arms
        await merge_manager.reset(card.id)
        ok = card.status == "idle" and card.slots == {} and card.expected_slots == [] and card.error_text is None
        print(f"[{'PASS' if ok else 'FAIL'}] manager — reset clears state")
        if not ok:
            print(f"    status={card.status} slots={card.slots} expected={card.expected_slots} error={card.error_text}")
            failures += 1

    # Cleanup
    merge_manager.delete_merge_card(card.id)
    delete_merge_card_file(card.id)

    print(f"\n{'PASS' if failures == 0 else 'FAIL'} ({failures} failure(s))")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
