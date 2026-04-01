import json
import logging
import os
from typing import AsyncIterator, Optional
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

logger = logging.getLogger(__name__)

INVOKE_AGENT_TOOL = {
    "type": "function",
    "function": {
        "name": "invoke_agent",
        "description": (
            "Invoke a sub-agent to handle a task. The sub-agent runs to completion "
            "and returns its response. Use this to delegate work to specialized agents. "
            "Available providers: 'ollama' (local LLM), 'claude-code' (Claude)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "provider_id": {
                    "type": "string",
                    "description": "Provider: 'ollama' or 'claude-code'",
                },
                "model": {
                    "type": "string",
                    "description": "Model name (e.g. 'qwen3:4b' for ollama, 'haiku' for claude-code)",
                },
                "message": {
                    "type": "string",
                    "description": "The task/message to send to the sub-agent",
                },
            },
            "required": ["provider_id", "model", "message"],
        },
    },
}


class OllamaProvider(AgentProvider):
    provider_id = "ollama"
    display_name = "Ollama"
    manages_own_tools = False

    def __init__(self, base_url: str = "http://localhost:11434") -> None:
        self.base_url = base_url.rstrip("/")
        self._sessions: dict[str, dict] = {}

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

        # Run the agentic loop: LLM call -> tool calls -> LLM call -> ...
        for iteration in range(10):  # max 10 tool-call rounds
            message_id = uuid4().hex
            assistant_text = ""
            tool_calls_accum: list[dict] = []

            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/v1/chat/completions",
                    json={
                        "model": state["model"],
                        "messages": state["messages"],
                        "stream": True,
                        "tools": [INVOKE_AGENT_TOOL],
                    },
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
                        finish_reason = choices[0].get("finish_reason")

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

                # Execute invoke_agent via backend HTTP
                if tc["name"] == "invoke_agent":
                    result_text = await self._execute_invoke_agent(args, session_id)
                else:
                    result_text = f"Unknown tool: {tc['name']}"

                # Add tool result to conversation
                state["messages"].append({
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": result_text,
                })

            # Continue the loop — LLM will see tool results and continue

        yield TurnComplete(stop_reason="max_iterations")

    async def _execute_invoke_agent(self, args: dict, parent_session_id: str) -> str:
        backend_port = os.environ.get("AGENTCANVAS_PORT", "8325")
        backend_url = f"http://127.0.0.1:{backend_port}"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
                resp = await client.post(
                    f"{backend_url}/api/agents/invoke",
                    json={
                        "provider_id": args.get("provider_id", "ollama"),
                        "model": args.get("model", ""),
                        "message": args.get("message", ""),
                        "parent_session_id": parent_session_id,
                    },
                )
                resp.raise_for_status()
                result = resp.json()
                return f"Sub-agent response (cost: ${result.get('cost_usd', 0):.4f}):\n\n{result.get('response', '')}"
        except Exception as e:
            return f"Error invoking agent: {e}"

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
