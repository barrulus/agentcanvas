"""JSON file persistence for sessions and dashboards."""

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from backend.agents.models import AgentSession, CardGroup, CardPosition, Connection, ViewCard

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


def _dashboards_dir() -> Path:
    d = _data_dir() / "dashboards"
    d.mkdir(exist_ok=True)
    return d


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


# --- View Cards ---

def _view_cards_dir() -> Path:
    d = _data_dir() / "view_cards"
    d.mkdir(exist_ok=True)
    return d


def save_view_card(card: ViewCard) -> None:
    path = _view_cards_dir() / f"{card.id}.json"
    path.write_text(json.dumps(card.model_dump(), indent=2))


def load_view_card(card_id: str) -> ViewCard | None:
    path = _view_cards_dir() / f"{card_id}.json"
    if not path.exists():
        return None
    try:
        return ViewCard.model_validate_json(path.read_text())
    except Exception:
        logger.warning("Failed to load view card %s", card_id)
        return None


def load_all_view_cards() -> list[ViewCard]:
    cards = []
    for path in _view_cards_dir().glob("*.json"):
        try:
            cards.append(ViewCard.model_validate_json(path.read_text()))
        except Exception:
            logger.warning("Skipping corrupt view card file %s", path.name)
    return cards


def delete_view_card_file(card_id: str) -> None:
    path = _view_cards_dir() / f"{card_id}.json"
    path.unlink(missing_ok=True)


# --- Dashboards ---

def _migrate_old_layout() -> None:
    """Migrate old single layout.json to dashboards/default.json if it exists."""
    old_path = _data_dir() / "layout.json"
    if old_path.exists() and not list(_dashboards_dir().glob("*.json")):
        try:
            old_data = json.loads(old_path.read_text())
            dashboard = {
                "id": "default",
                "name": "Default",
                "cards": old_data,  # old format was just the cards dict
                "created_at": datetime.now().timestamp(),
            }
            (_dashboards_dir() / "default.json").write_text(json.dumps(dashboard, indent=2))
            old_path.rename(old_path.with_suffix(".json.bak"))
            logger.info("Migrated layout.json to dashboards/default.json")
        except Exception:
            logger.warning("Failed to migrate old layout.json")


def list_dashboards() -> list[dict]:
    """Return list of dashboard metadata (id, name, card_count, created_at)."""
    _migrate_old_layout()
    dashboards = []
    for path in _dashboards_dir().glob("*.json"):
        try:
            data = json.loads(path.read_text())
            dashboards.append({
                "id": data["id"],
                "name": data.get("name", "Untitled"),
                "card_count": len(data.get("cards", {})),
                "created_at": data.get("created_at", 0),
            })
        except Exception:
            logger.warning("Skipping corrupt dashboard file %s", path.name)
    dashboards.sort(key=lambda d: d["created_at"])
    return dashboards


def create_dashboard(name: str = "New Canvas") -> dict:
    """Create a new empty dashboard and return its full data."""
    dashboard_id = uuid4().hex
    dashboard = {
        "id": dashboard_id,
        "name": name,
        "cards": {},
        "created_at": datetime.now().timestamp(),
    }
    path = _dashboards_dir() / f"{dashboard_id}.json"
    path.write_text(json.dumps(dashboard, indent=2))
    return dashboard


def get_dashboard(dashboard_id: str) -> dict | None:
    """Load a dashboard by ID, returning full data including cards."""
    _migrate_old_layout()
    path = _dashboards_dir() / f"{dashboard_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        logger.warning("Failed to load dashboard %s", dashboard_id)
        return None


def update_dashboard(dashboard_id: str, updates: dict) -> dict | None:
    """Update dashboard fields (name, cards)."""
    dashboard = get_dashboard(dashboard_id)
    if not dashboard:
        return None
    dashboard.update(updates)
    dashboard["id"] = dashboard_id  # prevent id change
    path = _dashboards_dir() / f"{dashboard_id}.json"
    path.write_text(json.dumps(dashboard, indent=2))
    return dashboard


def delete_dashboard(dashboard_id: str) -> None:
    path = _dashboards_dir() / f"{dashboard_id}.json"
    path.unlink(missing_ok=True)


def save_dashboard_layout(
    dashboard_id: str,
    cards: dict[str, CardPosition],
    connections: list[Connection] | None = None,
    groups: list[CardGroup] | None = None,
) -> None:
    """Save cards (and optionally connections/groups) of a dashboard."""
    dashboard = get_dashboard(dashboard_id)
    if not dashboard:
        # Auto-create if doesn't exist
        dashboard = {
            "id": dashboard_id,
            "name": "Canvas",
            "cards": {},
            "connections": [],
            "groups": [],
            "created_at": datetime.now().timestamp(),
        }
    dashboard["cards"] = {sid: card.model_dump() for sid, card in cards.items()}
    if connections is not None:
        dashboard["connections"] = [c.model_dump() for c in connections]
    if groups is not None:
        dashboard["groups"] = [g.model_dump() for g in groups]
    path = _dashboards_dir() / f"{dashboard_id}.json"
    path.write_text(json.dumps(dashboard, indent=2))


def load_dashboard_layout(dashboard_id: str) -> tuple[dict[str, CardPosition], list[Connection], list[CardGroup]]:
    """Load cards, connections, and groups from a specific dashboard."""
    dashboard = get_dashboard(dashboard_id)
    if not dashboard:
        return {}, [], []
    try:
        cards = {sid: CardPosition.model_validate(card) for sid, card in dashboard.get("cards", {}).items()}
    except Exception:
        logger.warning("Failed to load layout for dashboard %s", dashboard_id)
        cards = {}
    try:
        connections = [Connection.model_validate(c) for c in dashboard.get("connections", [])]
    except Exception:
        logger.warning("Failed to load connections for dashboard %s", dashboard_id)
        connections = []
    try:
        groups = [CardGroup.model_validate(g) for g in dashboard.get("groups", [])]
    except Exception:
        logger.warning("Failed to load groups for dashboard %s", dashboard_id)
        groups = []
    return cards, connections, groups


def load_dashboard_connections(dashboard_id: str) -> list[Connection]:
    """Load just the connections from a dashboard."""
    dashboard = get_dashboard(dashboard_id)
    if not dashboard:
        return []
    try:
        return [Connection.model_validate(c) for c in dashboard.get("connections", [])]
    except Exception:
        return []


# Keep old functions as aliases for backward compatibility during migration
def save_layout(cards: dict[str, CardPosition]) -> None:
    save_dashboard_layout("default", cards)

def load_layout() -> dict[str, CardPosition]:
    _migrate_old_layout()
    cards, _connections, _groups = load_dashboard_layout("default")
    return cards
