from datetime import datetime
from typing import Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class AgentMode(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str
    slug: str
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    tool_restrictions: Optional[list[str]] = None  # None = all tools, [] = no tools
    is_builtin: bool = False
    icon: Optional[str] = None
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())
