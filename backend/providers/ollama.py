import json
import logging
from typing import AsyncIterator, Optional, TYPE_CHECKING
from uuid import uuid4

import httpx

from backend.providers.base import (
    AgentProvider,
    StreamEvent,
    TextDelta,
    ToolCallStart,
    ToolCallComplete,
    TurnComplete,
)

if TYPE_CHECKING:
    from backend.mcp.tool_executor import ToolExecutor

logger = logging.getLogger(__name__)


class OllamaProvider(AgentProvider):
    provider_id = "ollama"
    display_name = "Ollama"
    manages_own_tools = False

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        tool_executor: "ToolExecutor | None" = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._sessions: dict[str, dict] = {}
        self._tool_executor = tool_executor

    async def start_session(
        self,
        session_id: str,
        model: str,
        system_prompt: Optional[str] = None,
        cwd: Optional[str] = None,
    ) -> None:
        messages: list[dict] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        self._sessions[session_id] = {
            "model": model,
            "messages": messages,
        }

    async def send_message(
        self, session_id: str, content: str
    ) -> AsyncIterator[StreamEvent]:
        state = self._sessions.get(session_id)
        if state is None:
            raise ValueError(f"Session {session_id} not initialized")

        state["messages"].append({"role": "user", "content": content})

        # Get available tools from executor (MCP servers + built-ins)
        tools: list[dict] = []
        if self._tool_executor:
            tools = await self._tool_executor.get_available_tools()

        # Agentic loop: LLM call -> tool calls -> LLM call -> ...
        for _ in range(10):
            message_id = uuid4().hex
            assistant_text = ""
            tool_calls_accum: list[dict] = []

            request_body: dict = {
                "model": state["model"],
                "messages": state["messages"],
                "stream": True,
            }
            if tools:
                request_body["tools"] = tools

            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
                try:
                    async with client.stream(
                        "POST",
                        f"{self.base_url}/v1/chat/completions",
                        json=request_body,
                    ) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            payload = line[len("data: "):]
                            if payload.strip() == "[DONE]":
                                break

                            try:
                                chunk = json.loads(payload)
                            except json.JSONDecodeError:
                                continue

                            choices = chunk.get("choices", [])
                            if not choices:
                                continue

                            delta = choices[0].get("delta", {})

                            # Text content
                            text = delta.get("content")
                            if text:
                                assistant_text += text
                                yield TextDelta(message_id=message_id, text=text)

                            # Tool calls
                            for tc in delta.get("tool_calls", []):
                                idx = tc.get("index", 0)
                                while len(tool_calls_accum) <= idx:
                                    tool_calls_accum.append({"id": "", "name": "", "arguments": ""})
                                if tc.get("id"):
                                    tool_calls_accum[idx]["id"] = tc["id"]
                                fn = tc.get("function", {})
                                if fn.get("name"):
                                    tool_calls_accum[idx]["name"] = fn["name"]
                                    yield ToolCallStart(
                                        message_id=message_id,
                                        tool_call_id=tc.get("id", f"call_{idx}"),
                                        tool_name=fn["name"],
                                    )
                                if fn.get("arguments"):
                                    tool_calls_accum[idx]["arguments"] += fn["arguments"]

                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 400 and tools:
                        # Model likely doesn't support tool calling — retry without tools
                        logger.info(
                            "Model %s returned 400 with tools; retrying without tools",
                            state["model"],
                        )
                        tools = []
                        request_body.pop("tools", None)
                        async with client.stream(
                            "POST",
                            f"{self.base_url}/v1/chat/completions",
                            json=request_body,
                        ) as response:
                            response.raise_for_status()
                            async for line in response.aiter_lines():
                                if not line.startswith("data: "):
                                    continue
                                payload = line[len("data: "):]
                                if payload.strip() == "[DONE]":
                                    break

                                try:
                                    chunk = json.loads(payload)
                                except json.JSONDecodeError:
                                    continue

                                choices = chunk.get("choices", [])
                                if not choices:
                                    continue

                                delta = choices[0].get("delta", {})

                                text = delta.get("content")
                                if text:
                                    assistant_text += text
                                    yield TextDelta(message_id=message_id, text=text)
                    else:
                        raise

            # Record assistant message in history
            assistant_msg: dict = {"role": "assistant", "content": assistant_text or None}
            if tool_calls_accum and tool_calls_accum[0]["name"]:
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc["id"] or f"call_{i}",
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                    }
                    for i, tc in enumerate(tool_calls_accum)
                ]
            state["messages"].append(assistant_msg)

            # If no tool calls, we're done
            if not tool_calls_accum or not tool_calls_accum[0]["name"]:
                yield TurnComplete(stop_reason="end_turn")
                return

            # Execute tool calls
            for i, tc in enumerate(tool_calls_accum):
                tc_id = tc["id"] or f"call_{i}"
                try:
                    args = json.loads(tc["arguments"])
                except json.JSONDecodeError:
                    args = {}

                yield ToolCallComplete(
                    message_id=message_id,
                    tool_call_id=tc_id,
                    tool_name=tc["name"],
                    arguments=args,
                )

                # Execute via ToolExecutor (handles MCP servers + invoke_agent)
                if self._tool_executor:
                    result_text = await self._tool_executor.execute_tool(
                        tc["name"], args,
                        parent_session_id=session_id,
                        session_id=session_id,
                    )
                else:
                    result_text = f"No tool executor configured for: {tc['name']}"

                state["messages"].append({
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": result_text,
                })

        yield TurnComplete(stop_reason="max_iterations")

    async def stop_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    async def list_models(self) -> list[dict]:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
                resp.raise_for_status()
                data = resp.json()
                return [
                    {"id": m["name"], "name": m["name"]}
                    for m in data.get("models", [])
                ]
        except httpx.ConnectError:
            return []
        except Exception as e:
            logger.warning("Failed to list Ollama models: %s", e)
            return []

    async def is_healthy(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
                return resp.status_code == 200
        except Exception:
            return False
