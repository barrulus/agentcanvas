"""Merge card manager — collects per-slot inputs and emits a composed message."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from backend.agents.models import MergeCard
from backend.agents.ws_manager import ws_manager
from backend.sessions.store import (
    delete_merge_card_file,
    load_all_merge_cards,
    load_dashboard_connections,
    load_merge_card,
    save_merge_card,
)

if TYPE_CHECKING:
    from backend.agents.agent_manager import AgentManager

logger = logging.getLogger(__name__)


class MergeManager:
    def __init__(self) -> None:
        self.cards: dict[str, MergeCard] = {}
        self._timers: dict[str, asyncio.Task] = {}

    # --- CRUD ---

    def create_merge_card(
        self,
        name: str = "Merge",
        template: str = "",
        timeout_seconds: int = 60,
        dashboard_id: str | None = None,
    ) -> MergeCard:
        card = MergeCard(
            name=name,
            template=template,
            timeout_seconds=timeout_seconds,
            dashboard_id=dashboard_id,
        )
        self.cards[card.id] = card
        save_merge_card(card)
        return card

    def get_merge_card(self, card_id: str) -> MergeCard | None:
        return self.cards.get(card_id)

    def update_merge_card(self, card_id: str, updates: dict) -> MergeCard | None:
        card = self.cards.get(card_id)
        if not card:
            return None
        for key, val in updates.items():
            if hasattr(card, key) and key not in ("id", "created_at", "slots", "expected_slots", "status"):
                setattr(card, key, val)
        save_merge_card(card)
        return card

    def delete_merge_card(self, card_id: str) -> None:
        self._cancel_timer(card_id)
        self.cards.pop(card_id, None)
        delete_merge_card_file(card_id)

    def list_merge_cards(self, dashboard_id: str | None = None) -> list[MergeCard]:
        cards = list(self.cards.values())
        if dashboard_id:
            cards = [c for c in cards if c.dashboard_id == dashboard_id]
        return cards

    def restore_merge_cards(self) -> None:
        for card in load_all_merge_cards():
            # Persisted `waiting` state can't be re-armed without a new input,
            # but slot data is preserved for inspection. Status stays as-is.
            self.cards[card.id] = card
        logger.info("Restored %d merge cards", len(self.cards))

    # --- Pipeline ---

    async def receive_input(
        self,
        card_id: str,
        upstream_name: str,
        text: str,
        agent_mgr: "AgentManager",
    ) -> None:
        """Called when a routed output arrives at a merge card."""
        card = self.cards.get(card_id)
        if not card or not card.dashboard_id:
            return

        # Snapshot expected_slots on the first input of a round.
        if not card.expected_slots:
            card.expected_slots = self._compute_expected(card_id, agent_mgr)
            if not card.expected_slots:
                logger.warning("Merge card %s has no resolvable inbound names; ignoring input", card_id)
                return

        key = upstream_name.lower()
        card.slots[key] = text  # latest-wins on duplicate
        card.status = "waiting"
        save_merge_card(card)
        await self._broadcast(card)

        if set(card.slots) >= set(card.expected_slots):
            await self._emit(card_id, agent_mgr)
        else:
            self._arm_timer(card_id)

    def _compute_expected(self, card_id: str, agent_mgr: "AgentManager") -> list[str]:
        """All direct-inbound upstream names (lowercase), sorted, deduped, first-match-wins on collision."""
        from backend.agents.agent_manager import _resolve_card_name  # added in M3

        card = self.cards.get(card_id)
        if not card or not card.dashboard_id:
            return []
        connections = load_dashboard_connections(card.dashboard_id)
        inbound = [c for c in connections if c.to_card_id == card_id]
        seen: set[str] = set()
        out: list[str] = []
        for c in inbound:
            name = _resolve_card_name(c.from_card_id, agent_mgr)
            if not name:
                continue
            key = name.lower()
            if key in seen:
                logger.warning("MergeCard %s: duplicate upstream name %r — keeping first", card_id, name)
                continue
            seen.add(key)
            out.append(key)
        return sorted(out)

    async def _emit(self, card_id: str, agent_mgr: "AgentManager") -> None:
        card = self.cards.get(card_id)
        if not card:
            return
        from backend.agents.agent_manager import (  # added in M3
            _apply_template_with_slots,
            route_to_downstream,
        )
        from datetime import datetime

        rendered = _apply_template_with_slots(card.template, card.slots)

        # Empty rendered output would be silently dropped by _route_single — surface as error
        # so the user sees why downstream stayed idle.
        if not rendered.strip():
            card.last_emitted_text = rendered
            card.last_emitted_at = datetime.now().timestamp()
            card.status = "error"
            card.error_text = (
                "Template is empty or rendered to empty string — set a template that "
                "references your inbound slots, e.g. {{slot.<UpstreamName>}}."
            )
            save_merge_card(card)
            self._cancel_timer(card_id)
            await self._broadcast(card)
            return

        card.last_emitted_text = rendered
        card.last_emitted_at = datetime.now().timestamp()
        card.status = "completed"
        card.error_text = None
        card.slots = {}
        card.expected_slots = []
        save_merge_card(card)
        self._cancel_timer(card_id)
        await self._broadcast(card)

        if card.dashboard_id:
            from backend.agents.run_manager import run_manager
            await route_to_downstream(
                card_id, rendered, card.dashboard_id, agent_mgr,
                run_id=run_manager.card_to_run_id(card_id),
            )

    def _arm_timer(self, card_id: str) -> None:
        card = self.cards.get(card_id)
        if not card or card.timeout_seconds <= 0:
            return
        if card_id in self._timers and not self._timers[card_id].done():
            return  # already armed
        self._timers[card_id] = asyncio.create_task(self._timeout(card_id, card.timeout_seconds))

    def _cancel_timer(self, card_id: str) -> None:
        task = self._timers.pop(card_id, None)
        if task and not task.done():
            task.cancel()

    async def _timeout(self, card_id: str, after_s: int) -> None:
        try:
            await asyncio.sleep(after_s)
        except asyncio.CancelledError:
            return
        card = self.cards.get(card_id)
        if not card or card.status != "waiting":
            return
        missing = sorted(set(card.expected_slots) - set(card.slots))
        card.status = "error"
        card.error_text = f"Timeout after {after_s}s — missing: {', '.join(missing) or '(none)'}"
        save_merge_card(card)
        await self._broadcast(card)

    async def reset(self, card_id: str) -> None:
        card = self.cards.get(card_id)
        if not card:
            return
        self._cancel_timer(card_id)
        card.slots = {}
        card.expected_slots = []
        card.status = "idle"
        card.error_text = None
        save_merge_card(card)
        await self._broadcast(card)

    async def _broadcast(self, card: MergeCard) -> None:
        await ws_manager.broadcast_dashboard(
            "merge_card:update",
            {"card_id": card.id, "card": card.model_dump()},
        )


merge_manager = MergeManager()
