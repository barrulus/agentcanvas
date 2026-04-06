from datetime import datetime
from typing import Any, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class BranchInfo(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    parent_branch_id: Optional[str] = None
    fork_message_id: str  # message ID of the fork point
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())
    label: Optional[str] = None


class Message(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    role: Literal["user", "assistant", "tool_call", "tool_result", "system"]
    content: Any  # str or structured content
    timestamp: float = Field(default_factory=lambda: datetime.now().timestamp())
    tool_name: Optional[str] = None
    tool_call_id: Optional[str] = None
    parent_id: Optional[str] = None  # parent message in branch tree
    branch_id: Optional[str] = None  # which branch this message belongs to


class AgentSession(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str = ""
    provider_id: str
    model: str
    status: Literal["idle", "running", "completed", "error", "stopped"] = "idle"
    system_prompt: Optional[str] = None
    messages: list[Message] = Field(default_factory=list)
    cost_usd: float = 0.0
    tokens: dict[str, int] = Field(
        default_factory=lambda: {"input": 0, "output": 0}
    )
    dashboard_id: Optional[str] = None
    parent_session_id: Optional[str] = None
    cwd: Optional[str] = None
    mode_id: Optional[str] = None
    worktree_path: Optional[str] = None
    repo_path: Optional[str] = None
    active_branch_id: Optional[str] = None
    branches: dict[str, BranchInfo] = Field(default_factory=dict)
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())
    closed_at: Optional[float] = None


class CardPosition(BaseModel):
    session_id: str
    x: float = 0
    y: float = 0
    width: float = 480
    height: float = 280
    z_order: int = 0
    card_type: Literal["agent", "view", "input", "gate"] = "agent"
    collapsed: bool = False


class ViewCard(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str = "Output"
    content: str = ""
    dashboard_id: Optional[str] = None
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())


class Connection(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    from_card_id: str
    to_card_id: str
    condition: Optional[str] = None  # e.g. "contains:error", "not_contains:ok", "regex:SUCCESS"
    output_schema: Optional[dict] = None  # JSON Schema to validate output before routing
    transform: Optional[str] = None  # Template string: {{output}} for full text, {{output.field}} for JSON field access
    gate_rule: Optional[str] = None  # Circuit breaker: "require:text", "reject:text", "min_length:N", "max_length:N"


class CardGroup(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str = "Group"
    member_ids: list[str] = Field(default_factory=list)
    collapsed: bool = False
    color: Optional[str] = None


class InputCard(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str = "Input"
    source_type: Literal["chat", "webhook", "file"] = "chat"
    config: dict = Field(default_factory=dict)  # e.g. {"path": "/tmp/watch.txt"} for file mode
    dashboard_id: Optional[str] = None
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())


class GateCard(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str = "Gate"
    mode: Literal["resolve", "synthesize"] = "resolve"
    provider_id: str = ""
    model: str = ""
    status: Literal["idle", "waiting", "resolving", "completed", "error"] = "idle"
    pending_inputs: dict[str, str] = Field(default_factory=dict)  # connection_id -> output text
    resolved_output: str = ""
    dashboard_id: Optional[str] = None
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())


class DashboardLayout(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str = "New Canvas"
    cards: dict[str, CardPosition] = Field(default_factory=dict)
    connections: list[Connection] = Field(default_factory=list)
    groups: list[CardGroup] = Field(default_factory=list)
    constraints: Optional[str] = None  # Workflow-level constraints injected into all routed messages
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())
