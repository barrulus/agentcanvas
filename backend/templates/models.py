from datetime import datetime
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class TemplateField(BaseModel):
    name: str
    label: str
    type: Literal["text", "textarea", "select", "number"] = "text"
    placeholder: Optional[str] = None
    default: Optional[str] = None
    options: Optional[list[str]] = None  # for select type
    required: bool = True


class PromptTemplate(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str
    slug: str  # for slash command invocation
    description: Optional[str] = None
    prompt: str  # template string with {{field_name}} placeholders
    fields: list[TemplateField] = Field(default_factory=list)
    provider_id: Optional[str] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())
    updated_at: float = Field(default_factory=lambda: datetime.now().timestamp())
