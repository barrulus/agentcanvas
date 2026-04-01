from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional
from dataclasses import dataclass


@dataclass
class StreamEvent:
    """Base class for streaming events."""

    pass


@dataclass
class TextDelta(StreamEvent):
    message_id: str
    text: str


@dataclass
class ToolCallStart(StreamEvent):
    message_id: str
    tool_call_id: str
    tool_name: str


@dataclass
class ToolCallDelta(StreamEvent):
    message_id: str
    tool_call_id: str
    partial_json: str


@dataclass
class ToolCallComplete(StreamEvent):
    message_id: str
    tool_call_id: str
    tool_name: str
    arguments: dict


@dataclass
class TurnComplete(StreamEvent):
    stop_reason: str  # "end_turn", "tool_use", "max_tokens", "error"
    error: Optional[str] = None


@dataclass
class CostUpdate(StreamEvent):
    cost_usd: float
    input_tokens: int
    output_tokens: int


class AgentProvider(ABC):
    provider_id: str
    display_name: str
    manages_own_tools: bool  # True for CLI agents (Claude Code), False for API agents (Ollama)

    @abstractmethod
    async def start_session(
        self,
        session_id: str,
        model: str,
        system_prompt: Optional[str] = None,
        cwd: Optional[str] = None,
    ) -> None:
        """Initialize provider state for a session."""

    @abstractmethod
    async def send_message(
        self, session_id: str, content: str
    ) -> AsyncIterator[StreamEvent]:
        """Send a user message and stream back response events."""

    @abstractmethod
    async def stop_session(self, session_id: str) -> None:
        """Clean up session resources."""

    @abstractmethod
    async def list_models(self) -> list[dict]:
        """Return available models: [{"id": "...", "name": "..."}]"""

    async def is_healthy(self) -> bool:
        return True
