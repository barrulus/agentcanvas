"""Dialogue card manager — runs orchestrator-driven multi-turn exchanges between N participants."""

import asyncio
import logging
import re

from backend.agents.models import DialogueCard, DialogueParticipant, DialogueTurn
from backend.agents.ws_manager import ws_manager
from backend.sessions.store import (
    delete_dialogue_card_file,
    load_all_dialogue_cards,
    load_dashboard_constraints,
    save_dialogue_card,
)

logger = logging.getLogger(__name__)

ASK_TAG = re.compile(r"\{\{ask:([^}]+)\}\}")
DONE_TAG = re.compile(r"\{\{done\}\}", re.IGNORECASE)


class DialogueManager:
    def __init__(self) -> None:
        self.cards: dict[str, DialogueCard] = {}

    # --- CRUD ---

    def create_dialogue_card(
        self,
        name: str = "Dialogue",
        participants: list[DialogueParticipant] | None = None,
        max_turns: int = 20,
        termination_rule: str | None = None,
        initial_prompt: str = "",
        output_mode: str = "last_message",
        dashboard_id: str | None = None,
    ) -> DialogueCard:
        card = DialogueCard(
            name=name,
            participants=participants or [],
            max_turns=max_turns,
            termination_rule=termination_rule,
            initial_prompt=initial_prompt,
            output_mode=output_mode,  # type: ignore[arg-type]
            dashboard_id=dashboard_id,
        )
        self.cards[card.id] = card
        save_dialogue_card(card)
        return card

    def get_dialogue_card(self, card_id: str) -> DialogueCard | None:
        return self.cards.get(card_id)

    def update_dialogue_card(self, card_id: str, updates: dict) -> DialogueCard | None:
        card = self.cards.get(card_id)
        if not card:
            return None
        for key, val in updates.items():
            if key == "participants" and isinstance(val, list):
                card.participants = [
                    DialogueParticipant.model_validate(p) if not isinstance(p, DialogueParticipant) else p
                    for p in val
                ]
                continue
            if hasattr(card, key) and key not in ("id", "created_at"):
                setattr(card, key, val)
        save_dialogue_card(card)
        return card

    def delete_dialogue_card(self, card_id: str) -> None:
        self.cards.pop(card_id, None)
        delete_dialogue_card_file(card_id)

    def list_dialogue_cards(self, dashboard_id: str | None = None) -> list[DialogueCard]:
        cards = list(self.cards.values())
        if dashboard_id:
            cards = [c for c in cards if c.dashboard_id == dashboard_id]
        return cards

    def restore_dialogue_cards(self) -> None:
        for card in load_all_dialogue_cards():
            self.cards[card.id] = card
        logger.info("Restored %d dialogue cards", len(self.cards))

    async def reset(self, card_id: str) -> None:
        card = self.cards.get(card_id)
        if not card:
            return
        card.transcript = []
        card.final_output = ""
        card.status = "idle"
        card.current_speaker = None
        save_dialogue_card(card)
        await self._broadcast(card)

    # --- Pipeline ---

    async def receive_input(self, card_id: str, connection_id: str, content: str) -> None:
        """An upstream card delivered content — treat it as the seed / initial_prompt append."""
        card = self.cards.get(card_id)
        if not card:
            return
        # Reset transcript to avoid accumulating across runs when an upstream retriggers.
        card.transcript = []
        card.final_output = ""
        await self._start(card, seed_content=content)

    async def start_manually(self, card_id: str) -> None:
        """Begin the dialogue with just the configured initial_prompt (no upstream trigger)."""
        card = self.cards.get(card_id)
        if not card:
            return
        card.transcript = []
        card.final_output = ""
        await self._start(card, seed_content=None)

    async def _start(self, card: DialogueCard, seed_content: str | None) -> None:
        if not card.participants:
            logger.warning("Dialogue card %s has no participants", card.id)
            card.status = "error"
            save_dialogue_card(card)
            await self._broadcast(card)
            from backend.agents.run_manager import run_manager
            run_manager.record_card_end(
                card.id,
                status=card.status,
                error_text=getattr(card, 'error_text', None),
            )
            return

        orchestrator = self._find_orchestrator(card)
        if orchestrator is None:
            logger.warning("Dialogue card %s has no orchestrator participant", card.id)
            card.status = "error"
            save_dialogue_card(card)
            await self._broadcast(card)
            from backend.agents.run_manager import run_manager
            run_manager.record_card_end(
                card.id,
                status=card.status,
                error_text=getattr(card, 'error_text', None),
            )
            return

        card.status = "running"
        seed = (card.initial_prompt or "").strip()
        if seed_content:
            seed = (seed + "\n\n" + seed_content).strip() if seed else seed_content.strip()
        if seed:
            card.transcript.append(DialogueTurn(speaker="user", content=seed))
        save_dialogue_card(card)
        await self._broadcast(card)

        # Kick off the loop as a background task so the HTTP caller returns immediately.
        asyncio.create_task(self._run_loop(card.id))

    async def _run_loop(self, card_id: str) -> None:
        card = self.cards.get(card_id)
        if not card:
            return
        orchestrator = self._find_orchestrator(card)
        if orchestrator is None:
            return

        try:
            # The orchestrator always takes the first real turn.
            next_speakers: list[DialogueParticipant] = [orchestrator]
            turn_count = 0
            while turn_count < card.max_turns and next_speakers:
                if len(next_speakers) == 1:
                    speaker = next_speakers[0]
                    turn_count += 1
                    card.current_speaker = speaker.name
                    save_dialogue_card(card)
                    await self._broadcast(card)

                    turn_output = await self._run_single_turn(card, speaker)

                    if speaker.role == "orchestrator":
                        if DONE_TAG.search(turn_output):
                            break
                        if self._matches_termination(card.termination_rule, turn_output):
                            break
                        asks = self._ask_targets(turn_output)
                        if asks:
                            workers: list[DialogueParticipant] = []
                            for name in asks:
                                w = self._find_by_name(card, name)
                                if w is None:
                                    logger.warning(
                                        "Dialogue %s: orchestrator asked for unknown participant '%s'",
                                        card.id, name,
                                    )
                                    continue
                                workers.append(w)
                            if not workers:
                                break
                            next_speakers = workers
                        else:
                            # Orchestrator spoke without asking anyone and without {{done}} — terminal.
                            break
                    else:
                        # Worker just answered — hand turn back to orchestrator.
                        next_speakers = [orchestrator]
                else:
                    # Fan-out: run workers in parallel against a single transcript snapshot.
                    workers = next_speakers
                    turn_count += len(workers)
                    card.current_speaker = ", ".join(w.name for w in workers)
                    save_dialogue_card(card)
                    await self._broadcast(card)

                    snapshot = list(card.transcript)
                    results = await asyncio.gather(
                        *[self._invoke_participant(card, w, snapshot) for w in workers],
                        return_exceptions=True,
                    )
                    for worker, r in zip(workers, results, strict=False):
                        if isinstance(r, BaseException):
                            logger.error(
                                "Dialogue %s: worker %s failed during fan-out: %s",
                                card.id, worker.name, r,
                            )
                            content, cost = f"[error: {r}]", 0.0
                        else:
                            content, cost = r
                        card.transcript.append(DialogueTurn(
                            speaker=worker.name, content=content, cost_usd=cost,
                        ))
                    save_dialogue_card(card)
                    await self._broadcast(card)

                    next_speakers = [orchestrator]

            # Produce final output.
            if card.output_mode == "synthesized_summary":
                card.current_speaker = f"{orchestrator.name} (synthesising)"
                save_dialogue_card(card)
                await self._broadcast(card)
                card.final_output = await self._synthesise(card, orchestrator)
            else:
                card.final_output = self._compose_output(card)
            card.status = "completed"
            card.current_speaker = None
            save_dialogue_card(card)
            await self._broadcast(card)
            from backend.agents.run_manager import run_manager
            run_manager.record_card_end(
                card.id,
                status=card.status,
                error_text=getattr(card, 'error_text', None),
            )

            # Route downstream.
            if card.dashboard_id and card.final_output:
                from backend.agents.agent_manager import agent_manager, route_to_downstream
                from backend.agents.run_manager import run_manager
                await route_to_downstream(
                    card.id, card.final_output, card.dashboard_id, agent_manager,
                    run_id=run_manager.card_to_run_id(card.id),
                )
        except Exception:
            logger.exception("Dialogue card %s failed", card_id)
            card.status = "error"
            card.current_speaker = None
            save_dialogue_card(card)
            await self._broadcast(card)
            from backend.agents.run_manager import run_manager
            run_manager.record_card_end(
                card.id,
                status=card.status,
                error_text=getattr(card, 'error_text', None),
            )

    # --- Turn execution ---

    async def _run_single_turn(self, card: DialogueCard, speaker: DialogueParticipant) -> str:
        """Run one participant turn, append the result to the transcript, and broadcast."""
        content, cost = await self._invoke_participant(card, speaker, list(card.transcript))
        card.transcript.append(DialogueTurn(speaker=speaker.name, content=content, cost_usd=cost))
        save_dialogue_card(card)
        await self._broadcast(card)
        return content

    async def _invoke_participant(
        self,
        card: DialogueCard,
        speaker: DialogueParticipant,
        transcript_snapshot: list[DialogueTurn],
    ) -> tuple[str, float]:
        """Build context from the given snapshot, invoke the speaker, return (content, cost)."""
        visible = self._visible_for_snapshot(transcript_snapshot, card, speaker)
        system_prompt = self._build_system_prompt(card, speaker)

        message = self._render_transcript_for(speaker, visible)
        if not message.strip():
            message = card.initial_prompt or "Begin."

        from backend.agents.agent_manager import agent_manager
        result = await agent_manager.invoke_agent(
            provider_id=speaker.provider_id,
            model=speaker.model,
            message=message,
            system_prompt=system_prompt,
            dashboard_id=card.dashboard_id,
            silent=True,
            tools_enabled=speaker.tools_enabled,
        )
        return (
            str(result.get("response") or "").strip(),
            float(result.get("cost_usd") or 0.0),
        )

    def _visible_for_snapshot(
        self,
        transcript: list[DialogueTurn],
        card: DialogueCard,
        speaker: DialogueParticipant,
    ) -> list[DialogueTurn]:
        if speaker.context_mode == "full":
            return list(transcript)
        if speaker.context_mode == "last_n":
            n = max(1, speaker.context_last_n)
            return list(transcript[-n:])
        # question_only: only the last orchestrator utterance (or the seed)
        for turn in reversed(transcript):
            if turn.speaker == "user" or self._is_orchestrator_name(card, turn.speaker):
                return [turn]
        return list(transcript[-1:])

    @staticmethod
    def _is_orchestrator_name(card: DialogueCard, name: str) -> bool:
        for p in card.participants:
            if p.name == name and p.role == "orchestrator":
                return True
        return False

    def _render_transcript_for(self, speaker: DialogueParticipant, turns: list[DialogueTurn]) -> str:
        if speaker.context_mode == "question_only" and turns:
            # The single relevant turn — strip routing tags so the worker only sees the question.
            last = turns[-1]
            return ASK_TAG.sub("", last.content).strip() or last.content
        lines = []
        for turn in turns:
            lines.append(f"[{turn.speaker}] {turn.content}")
        return "\n\n".join(lines)

    def _build_system_prompt(self, card: DialogueCard, speaker: DialogueParticipant) -> str:
        parts: list[str] = []
        if speaker.system_prompt.strip():
            parts.append(speaker.system_prompt.strip())

        if speaker.role == "orchestrator":
            workers = [p for p in card.participants if p.role == "worker"]
            if workers:
                roster = "\n".join(
                    f"- {w.name}: {w.description or 'no description provided'}" for w in workers
                )
                parts.append(
                    "You are orchestrating a multi-turn dialogue. The following specialists are available:\n"
                    f"{roster}\n\n"
                    "To route the next turn to a specialist, emit a tag of the form {{ask:Name}} (one worker) "
                    "or {{ask:Alice,Bob,Carol}} (parallel fan-out — every named worker answers in parallel "
                    "against your reply, and you get the next turn to synthesise their responses). "
                    "The reply you write is what each addressed worker will see. "
                    "When you have reached a conclusion and want to end the dialogue, emit {{done}}. "
                    "If you reply without any tag, the dialogue ends and your reply becomes the final output."
                )
            if card.termination_rule:
                parts.append(f"Termination rule: {card.termination_rule}")

        if card.dashboard_id:
            constraints = load_dashboard_constraints(card.dashboard_id)
            if constraints:
                parts.append(f"Workflow constraints:\n{constraints}")

        return "\n\n".join(parts)

    # --- Helpers ---

    @staticmethod
    def _find_orchestrator(card: DialogueCard) -> DialogueParticipant | None:
        for p in card.participants:
            if p.role == "orchestrator":
                return p
        return None

    @staticmethod
    def _find_by_name(card: DialogueCard, name: str) -> DialogueParticipant | None:
        lc = name.strip().lower()
        for p in card.participants:
            if p.name.lower() == lc:
                return p
        return None

    @staticmethod
    def _ask_targets(text: str) -> list[str]:
        """Parse the first {{ask:...}} tag in text and return its comma-separated names."""
        m = ASK_TAG.search(text or "")
        if not m:
            return []
        names = [n.strip() for n in m.group(1).split(",")]
        return [n for n in names if n]

    @staticmethod
    def _matches_termination(rule: str | None, text: str) -> bool:
        if not rule or not text:
            return False
        parts = rule.split(":", 1)
        if len(parts) != 2:
            return False
        kind, needle = parts[0].strip().lower(), parts[1].strip()
        if kind == "contains":
            return needle.lower() in text.lower()
        if kind == "regex":
            try:
                return re.search(needle, text) is not None
            except re.error:
                return False
        return False

    @staticmethod
    def _compose_output(card: DialogueCard) -> str:
        if card.output_mode == "full_transcript":
            return "\n\n".join(f"[{t.speaker}] {t.content}" for t in card.transcript)
        # last_message: strip tags from the last orchestrator turn (or last turn overall).
        for turn in reversed(card.transcript):
            if DialogueManager._is_orchestrator_name(card, turn.speaker):
                cleaned = ASK_TAG.sub("", turn.content)
                cleaned = DONE_TAG.sub("", cleaned).strip()
                return cleaned
        return card.transcript[-1].content if card.transcript else ""

    async def _synthesise(self, card: DialogueCard, orchestrator: DialogueParticipant) -> str:
        """Final orchestrator pass that condenses the transcript into a self-contained answer."""
        if not card.transcript:
            return ""
        transcript_text = "\n\n".join(f"[{t.speaker}] {t.content}" for t in card.transcript)
        synth_system_parts: list[str] = []
        if orchestrator.system_prompt.strip():
            synth_system_parts.append(orchestrator.system_prompt.strip())
        synth_system_parts.append(
            "The dialogue has ended. Synthesise a single, self-contained final answer that "
            "captures the conclusion reached above. Do not address the participants. "
            "Do not include any routing tags such as {{ask:...}} or {{done}}."
        )
        if card.dashboard_id:
            constraints = load_dashboard_constraints(card.dashboard_id)
            if constraints:
                synth_system_parts.append(f"Workflow constraints:\n{constraints}")
        synth_system = "\n\n".join(synth_system_parts)

        message = (
            (card.initial_prompt + "\n\n" if card.initial_prompt else "")
            + "Transcript:\n\n"
            + transcript_text
        )

        from backend.agents.agent_manager import agent_manager
        result = await agent_manager.invoke_agent(
            provider_id=orchestrator.provider_id,
            model=orchestrator.model,
            message=message,
            system_prompt=synth_system,
            dashboard_id=card.dashboard_id,
            silent=True,
            tools_enabled=orchestrator.tools_enabled,
        )
        output = str(result.get("response") or "").strip()
        cleaned = ASK_TAG.sub("", output)
        cleaned = DONE_TAG.sub("", cleaned).strip()
        return cleaned

    async def _broadcast(self, card: DialogueCard) -> None:
        await ws_manager.broadcast_dashboard(
            "dialogue_card:update",
            {"card_id": card.id, "card": card.model_dump()},
        )


dialogue_manager = DialogueManager()
