"""CLI command allowlisting and audit logging."""

import fnmatch
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class CommandPolicy(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    pattern: str  # glob or regex pattern to match against commands
    pattern_type: Literal["glob", "regex"] = "glob"
    action: Literal["allow", "deny", "ask"] = "ask"
    scope: Literal["global", "mode"] = "global"
    scope_id: Optional[str] = None  # mode_id when scope="mode"
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())


class CommandAuditEntry(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    session_id: str
    command: str
    action_taken: str  # "allowed", "denied", "approved", "rejected"
    policy_id: Optional[str] = None
    timestamp: float = Field(default_factory=lambda: datetime.now().timestamp())


def _data_dir() -> Path:
    import os
    xdg = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    return Path(xdg) / "agentcanvas"


def _policies_path() -> Path:
    return _data_dir() / "command_policies.json"


def _audit_dir() -> Path:
    d = _data_dir() / "command_audit"
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_policies() -> list[CommandPolicy]:
    """Load all command policies from disk."""
    path = _policies_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
        return [CommandPolicy(**p) for p in data]
    except Exception:
        logger.warning("Failed to load command policies")
        return []


def save_policies(policies: list[CommandPolicy]) -> None:
    """Save all command policies to disk."""
    path = _policies_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([p.model_dump() for p in policies], indent=2))


def get_policy(policy_id: str) -> CommandPolicy | None:
    """Get a single policy by ID."""
    for p in load_policies():
        if p.id == policy_id:
            return p
    return None


def save_policy(policy: CommandPolicy) -> None:
    """Add or update a single policy."""
    policies = load_policies()
    existing = next((i for i, p in enumerate(policies) if p.id == policy.id), None)
    if existing is not None:
        policies[existing] = policy
    else:
        policies.append(policy)
    save_policies(policies)


def delete_policy(policy_id: str) -> None:
    """Delete a policy by ID."""
    policies = [p for p in load_policies() if p.id != policy_id]
    save_policies(policies)


def _match_pattern(pattern: str, pattern_type: str, command: str) -> bool:
    """Check if a command matches a policy pattern."""
    if pattern_type == "regex":
        try:
            return bool(re.search(pattern, command))
        except re.error:
            return False
    else:  # glob
        return fnmatch.fnmatch(command, pattern) or fnmatch.fnmatch(command.split()[0] if command.strip() else "", pattern)


def evaluate_command(command: str, mode_id: str | None = None) -> tuple[str, str | None]:
    """Evaluate a command against policies.

    Returns (action, policy_id) where action is "allow", "deny", or "ask".
    More specific scopes take precedence (mode > global).
    """
    policies = load_policies()

    # Check mode-specific policies first
    if mode_id:
        for p in policies:
            if p.scope == "mode" and p.scope_id == mode_id and _match_pattern(p.pattern, p.pattern_type, command):
                return p.action, p.id

    # Check global policies
    for p in policies:
        if p.scope == "global" and _match_pattern(p.pattern, p.pattern_type, command):
            return p.action, p.id

    # Default: allow (no matching policy)
    return "allow", None


def save_audit_entry(entry: CommandAuditEntry) -> None:
    """Save an audit log entry for a session."""
    path = _audit_dir() / f"{entry.session_id}.jsonl"
    with path.open("a") as f:
        f.write(json.dumps(entry.model_dump()) + "\n")


def get_audit_log(session_id: str, limit: int = 100) -> list[CommandAuditEntry]:
    """Get audit log entries for a session."""
    path = _audit_dir() / f"{session_id}.jsonl"
    if not path.exists():
        return []
    entries = []
    try:
        for line in path.read_text().strip().split("\n"):
            if line:
                entries.append(CommandAuditEntry(**json.loads(line)))
    except Exception:
        logger.warning("Failed to load audit log for session %s", session_id)
    return entries[-limit:]
