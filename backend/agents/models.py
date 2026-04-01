from datetime import datetime
from typing import Any, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class Message(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    role: Literal["user", "assistant", "tool_call", "tool_result", "system"]
    content: Any  # str or structured content
    timestamp: float = Field(default_factory=lambda: datetime.now().timestamp())
    tool_name: Optional[str] = None
    tool_call_id: Optional[str] = None


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
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())


class CardPosition(BaseModel):
    session_id: str
    x: float = 0
    y: float = 0
    width: float = 480
    height: float = 280
    z_order: int = 0


class DashboardLayout(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str = "New Canvas"
    cards: dict[str, CardPosition] = Field(default_factory=dict)
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())
