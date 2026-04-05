"""Manager for INPUT cards — workflow entry points that route content to downstream agents."""

import asyncio
import logging
from pathlib import Path
from typing import Literal

from backend.agents.models import InputCard
from backend.agents.ws_manager import ws_manager
from backend.sessions.store import (
    delete_input_card_file,
    load_all_input_cards,
    load_input_card,
    save_input_card,
)

logger = logging.getLogger(__name__)


class InputManager:
    def __init__(self) -> None:
        self.cards: dict[str, InputCard] = {}
        self._file_watchers: dict[str, asyncio.Task] = {}

    def create_input_card(
        self,
        name: str = "Input",
        source_type: Literal["chat", "webhook", "file"] = "chat",
        config: dict | None = None,
        dashboard_id: str | None = None,
    ) -> InputCard:
        card = InputCard(
            name=name,
            source_type=source_type,
            config=config or {},
            dashboard_id=dashboard_id,
        )
        self.cards[card.id] = card
        save_input_card(card)

        # Start file watcher if applicable
        if source_type == "file" and config and config.get("path"):
            self._start_file_watcher(card.id)

        return card

    def update_input_card(self, card_id: str, updates: dict) -> InputCard | None:
        card = self.cards.get(card_id)
        if not card:
            return None

        was_file = card.source_type == "file"

        if "name" in updates:
            card.name = updates["name"]
        if "source_type" in updates:
            card.source_type = updates["source_type"]
        if "config" in updates:
            card.config = updates["config"]

        save_input_card(card)

        # Manage file watcher lifecycle
        if was_file and card.source_type != "file":
            self._stop_file_watcher(card_id)
        elif card.source_type == "file" and card.config.get("path"):
            self._stop_file_watcher(card_id)
            self._start_file_watcher(card_id)

        return card

    def delete_input_card(self, card_id: str) -> None:
        self._stop_file_watcher(card_id)
        self.cards.pop(card_id, None)
        delete_input_card_file(card_id)

    def get_input_card(self, card_id: str) -> InputCard | None:
        return self.cards.get(card_id)

    def list_input_cards(self, dashboard_id: str | None = None) -> list[InputCard]:
        cards = list(self.cards.values())
        if dashboard_id:
            cards = [c for c in cards if c.dashboard_id == dashboard_id]
        return cards

    async def send_to_downstream(self, card_id: str, content: str) -> None:
        """Route content from an input card to all downstream connections."""
        card = self.cards.get(card_id)
        if not card or not card.dashboard_id:
            return

        from backend.agents.agent_manager import agent_manager, clear_downstream, route_to_downstream
        # Clear all downstream agent messages and view card content before routing
        await clear_downstream(card_id, card.dashboard_id, agent_manager)
        await route_to_downstream(card_id, content, card.dashboard_id, agent_manager)

    def restore_input_cards(self) -> None:
        """Load persisted input cards from disk on startup."""
        for card in load_all_input_cards():
            self.cards[card.id] = card
            if card.source_type == "file" and card.config.get("path"):
                self._start_file_watcher(card.id)
        logger.info("Restored %d input cards from disk", len(self.cards))

    # --- File Watcher ---

    def _start_file_watcher(self, card_id: str) -> None:
        self._stop_file_watcher(card_id)
        task = asyncio.create_task(self._watch_file(card_id))
        self._file_watchers[card_id] = task

    def _stop_file_watcher(self, card_id: str) -> None:
        task = self._file_watchers.pop(card_id, None)
        if task and not task.done():
            task.cancel()

    async def _watch_file(self, card_id: str) -> None:
        """Poll a file for changes and route content downstream when modified."""
        card = self.cards.get(card_id)
        if not card:
            return

        path = Path(card.config.get("path", ""))
        if not path.exists():
            logger.warning("File watcher: path %s does not exist for card %s", path, card_id)
            return

        last_mtime = path.stat().st_mtime if path.is_file() else 0.0

        try:
            while True:
                await asyncio.sleep(2)
                card = self.cards.get(card_id)
                if not card:
                    break

                path = Path(card.config.get("path", ""))
                if not path.exists():
                    continue

                if path.is_file():
                    mtime = path.stat().st_mtime
                    if mtime > last_mtime:
                        last_mtime = mtime
                        content = path.read_text(errors="replace")
                        await self.send_to_downstream(card_id, content)
                        await ws_manager.broadcast_dashboard(
                            "input_card:triggered",
                            {"card_id": card_id, "source": "file", "path": str(path)},
                        )
                elif path.is_dir():
                    # Watch for any new/modified files in the directory
                    latest = 0.0
                    latest_file = None
                    for f in path.iterdir():
                        if f.is_file():
                            mt = f.stat().st_mtime
                            if mt > latest:
                                latest = mt
                                latest_file = f
                    if latest > last_mtime and latest_file:
                        last_mtime = latest
                        content = latest_file.read_text(errors="replace")
                        await self.send_to_downstream(card_id, content)
                        await ws_manager.broadcast_dashboard(
                            "input_card:triggered",
                            {"card_id": card_id, "source": "file", "path": str(latest_file)},
                        )
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("File watcher error for card %s", card_id)


input_manager = InputManager()
