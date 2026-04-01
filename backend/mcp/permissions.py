import json
import logging
import os
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

PermissionPolicy = Literal["always_allow", "ask", "deny"]

def _permissions_path() -> Path:
    xdg = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    return Path(xdg) / "agentcanvas" / "permissions.json"

def get_permissions() -> dict[str, str]:
    """Load all permissions from disk."""
    path = _permissions_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        logger.warning("Failed to load permissions")
        return {}

def set_permission(tool_name: str, policy: PermissionPolicy) -> None:
    """Set permission for a single tool."""
    perms = get_permissions()
    perms[tool_name] = policy
    _save(perms)

def set_permissions_bulk(updates: dict[str, str]) -> None:
    """Bulk update permissions."""
    perms = get_permissions()
    perms.update(updates)
    _save(perms)

def get_policy(tool_name: str) -> PermissionPolicy:
    """Get the policy for a tool, defaulting based on name heuristic."""
    perms = get_permissions()
    if tool_name in perms:
        return perms[tool_name]
    return _default_policy(tool_name)

def _default_policy(tool_name: str) -> PermissionPolicy:
    """Heuristic: read-like tools are auto-allowed, others require approval."""
    lower = tool_name.lower()
    read_patterns = ["read", "list", "get", "search", "find", "show", "describe", "view", "fetch", "query"]
    for pattern in read_patterns:
        if pattern in lower:
            return "always_allow"
    return "ask"

def _save(perms: dict[str, str]) -> None:
    path = _permissions_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(perms, indent=2))
