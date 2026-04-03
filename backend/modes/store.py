"""Agent mode persistence and built-in mode definitions."""

import json
import logging
from pathlib import Path

from backend.modes.models import AgentMode
from backend.sessions.store import _data_dir

logger = logging.getLogger(__name__)


BUILTIN_MODES = [
    AgentMode(
        id="agent",
        name="Agent",
        slug="agent",
        description="Full agent with all tools enabled",
        system_prompt=None,
        tool_restrictions=None,
        is_builtin=True,
        icon="A",
    ),
    AgentMode(
        id="ask",
        name="Ask",
        slug="ask",
        description="Answer questions without modifying files. Read-only tool access.",
        system_prompt="You are in Ask mode. Answer questions using your knowledge and by reading files. Do NOT use tools to modify files or execute commands.",
        tool_restrictions=None,  # Handled by provider via --allowedTools
        is_builtin=True,
        icon="?",
    ),
    AgentMode(
        id="plan",
        name="Plan",
        slug="plan",
        description="Analyze tasks and create implementation plans. No tool usage.",
        system_prompt="You are in Plan mode. Analyze the task and create a detailed implementation plan. Do NOT make any changes or execute any tools. Only provide analysis and planning.",
        tool_restrictions=[],
        is_builtin=True,
        icon="P",
    ),
]

_BUILTIN_MAP = {m.id: m for m in BUILTIN_MODES}


def _modes_dir() -> Path:
    d = _data_dir() / "modes"
    d.mkdir(exist_ok=True)
    return d


def get_all_modes() -> list[AgentMode]:
    modes = list(BUILTIN_MODES)
    for path in _modes_dir().glob("*.json"):
        try:
            modes.append(AgentMode.model_validate_json(path.read_text()))
        except Exception:
            logger.warning("Skipping corrupt mode file %s", path.name)
    return modes


def get_mode(mode_id: str) -> AgentMode | None:
    if mode_id in _BUILTIN_MAP:
        return _BUILTIN_MAP[mode_id]
    path = _modes_dir() / f"{mode_id}.json"
    if not path.exists():
        return None
    try:
        return AgentMode.model_validate_json(path.read_text())
    except Exception:
        return None


def save_mode(mode: AgentMode) -> None:
    path = _modes_dir() / f"{mode.id}.json"
    path.write_text(json.dumps(mode.model_dump(), indent=2))


def delete_mode(mode_id: str) -> None:
    if mode_id in _BUILTIN_MAP:
        return  # Can't delete built-ins
    path = _modes_dir() / f"{mode_id}.json"
    path.unlink(missing_ok=True)
