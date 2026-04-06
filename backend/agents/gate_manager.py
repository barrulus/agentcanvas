"""Gate card manager — collects upstream outputs and resolves via LLM."""

import logging
from backend.agents.models import GateCard
from backend.agents.ws_manager import ws_manager
from backend.sessions.store import (
    delete_gate_card_file,
    load_all_gate_cards,
    load_dashboard_connections,
    load_dashboard_constraints,
    load_gate_card,
    save_gate_card,
)

logger = logging.getLogger(__name__)


class GateManager:
    def __init__(self) -> None:
        self.cards: dict[str, GateCard] = {}

    # --- CRUD ---

    def create_gate_card(
        self,
        name: str = "Gate",
        mode: str = "resolve",
        provider_id: str = "",
        model: str = "",
        dashboard_id: str | None = None,
    ) -> GateCard:
        card = GateCard(
            name=name,
            mode=mode,  # type: ignore[arg-type]
            provider_id=provider_id,
            model=model,
            dashboard_id=dashboard_id,
        )
        self.cards[card.id] = card
        save_gate_card(card)
        return card

    def get_gate_card(self, card_id: str) -> GateCard | None:
        return self.cards.get(card_id)

    def update_gate_card(self, card_id: str, updates: dict) -> GateCard | None:
        card = self.cards.get(card_id)
        if not card:
            return None
        for key, val in updates.items():
            if hasattr(card, key) and key not in ("id", "created_at"):
                setattr(card, key, val)
        save_gate_card(card)
        return card

    def delete_gate_card(self, card_id: str) -> None:
        self.cards.pop(card_id, None)
        delete_gate_card_file(card_id)

    def list_gate_cards(self, dashboard_id: str | None = None) -> list[GateCard]:
        cards = list(self.cards.values())
        if dashboard_id:
            cards = [c for c in cards if c.dashboard_id == dashboard_id]
        return cards

    def restore_gate_cards(self) -> None:
        for card in load_all_gate_cards():
            self.cards[card.id] = card
        logger.info("Restored %d gate cards", len(self.cards))

    # --- Pipeline logic ---

    async def receive_input(
        self, card_id: str, connection_id: str, content: str
    ) -> None:
        """Called when a routed output arrives at a gate card."""
        card = self.cards.get(card_id)
        if not card:
            return
        card.pending_inputs[connection_id] = content
        card.status = "waiting"
        save_gate_card(card)

        await ws_manager.broadcast_dashboard(
            "gate_card:update",
            {"card_id": card_id, "card": card.model_dump()},
        )

        # Check if all upstream connections have delivered
        if not card.dashboard_id:
            return
        connections = load_dashboard_connections(card.dashboard_id)
        upstream_conn_ids = {c.id for c in connections if c.to_card_id == card_id}

        if upstream_conn_ids and upstream_conn_ids <= set(card.pending_inputs.keys()):
            await self._resolve(card_id)

    async def _resolve(self, card_id: str) -> None:
        """All inputs collected. Send to LLM for resolution."""
        card = self.cards.get(card_id)
        if not card or not card.provider_id or not card.model:
            logger.warning("Gate card %s missing provider/model, cannot resolve", card_id)
            card.status = "error"  # type: ignore[union-attr]
            save_gate_card(card)  # type: ignore[arg-type]
            return

        card.status = "resolving"
        save_gate_card(card)
        await ws_manager.broadcast_dashboard(
            "gate_card:update",
            {"card_id": card_id, "card": card.model_dump()},
        )

        # Load dashboard constraints
        constraints = ""
        if card.dashboard_id:
            constraints = load_dashboard_constraints(card.dashboard_id)

        # Build resolution prompt
        inputs_text = "\n\n".join(
            f"--- Input {i + 1} ---\n{text}"
            for i, (_, text) in enumerate(card.pending_inputs.items())
        )

        if card.mode == "resolve":
            system = (
                "You are a decision gate. Multiple upstream agents have produced outputs. "
                "Evaluate them against the given constraints and select the best one. "
                "Briefly explain your reasoning, then output the selected result clearly."
            )
        else:
            system = (
                "You are a synthesis gate. Multiple upstream agents have produced outputs. "
                "Synthesize them into a single coherent output that satisfies all constraints. "
                "Resolve any contradictions explicitly."
            )

        if constraints:
            system += f"\n\nWorkflow constraints:\n{constraints}"

        try:
            from backend.agents.agent_manager import agent_manager

            result = await agent_manager.invoke_agent(
                provider_id=card.provider_id,
                model=card.model,
                message=inputs_text,
                system_prompt=system,
                dashboard_id=card.dashboard_id,
                silent=True,
            )

            card.resolved_output = result["response"]
            card.status = "completed"
            save_gate_card(card)
            await ws_manager.broadcast_dashboard(
                "gate_card:update",
                {"card_id": card_id, "card": card.model_dump()},
            )

            # Route resolved output downstream
            from backend.agents.agent_manager import route_to_downstream

            await route_to_downstream(
                card_id, card.resolved_output, card.dashboard_id, agent_manager
            )
        except Exception:
            logger.exception("Gate card %s resolution failed", card_id)
            card.status = "error"
            card.resolved_output = ""
            save_gate_card(card)
            await ws_manager.broadcast_dashboard(
                "gate_card:update",
                {"card_id": card_id, "card": card.model_dump()},
            )

    async def reset(self, card_id: str) -> None:
        """Clear pending inputs and resolved output."""
        card = self.cards.get(card_id)
        if card:
            card.pending_inputs = {}
            card.resolved_output = ""
            card.status = "idle"
            save_gate_card(card)
            await ws_manager.broadcast_dashboard(
                "gate_card:update",
                {"card_id": card_id, "card": card.model_dump()},
            )


gate_manager = GateManager()
