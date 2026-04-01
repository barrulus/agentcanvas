"""JSON file persistence for sessions and dashboard layout."""

import json
import logging
import os
from pathlib import Path

from backend.agents.models import AgentSession, CardPosition

logger = logging.getLogger(__name__)


def _data_dir() -> Path:
    xdg = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    d = Path(xdg) / "agentcanvas"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _sessions_dir() -> Path:
    d = _data_dir() / "sessions"
    d.mkdir(exist_ok=True)
    return d


def _layout_path() -> Path:
    return _data_dir() / "layout.json"


# --- Sessions ---

def save_session(session: AgentSession) -> None:
    path = _sessions_dir() / f"{session.id}.json"
    path.write_text(json.dumps(session.model_dump(), indent=2))


def load_session(session_id: str) -> AgentSession | None:
    path = _sessions_dir() / f"{session_id}.json"
    if not path.exists():
        return None
    try:
        return AgentSession.model_validate_json(path.read_text())
    except Exception:
        logger.warning("Failed to load session %s", session_id)
        return None


def load_all_sessions() -> list[AgentSession]:
    sessions = []
    for path in _sessions_dir().glob("*.json"):
        try:
            sessions.append(AgentSession.model_validate_json(path.read_text()))
        except Exception:
            logger.warning("Skipping corrupt session file %s", path.name)
    return sessions


def delete_session_file(session_id: str) -> None:
    path = _sessions_dir() / f"{session_id}.json"
    path.unlink(missing_ok=True)


# --- Layout ---

def save_layout(cards: dict[str, CardPosition]) -> None:
    data = {sid: card.model_dump() for sid, card in cards.items()}
    _layout_path().write_text(json.dumps(data, indent=2))


def load_layout() -> dict[str, CardPosition]:
    path = _layout_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        return {sid: CardPosition.model_validate(card) for sid, card in data.items()}
    except Exception:
        logger.warning("Failed to load layout")
        return {}
