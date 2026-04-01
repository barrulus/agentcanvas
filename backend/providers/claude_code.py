import asyncio
import json
import logging
import os
import sys
import tempfile
from pathlib import Path  # noqa: used in _build_mcp_config
from typing import AsyncIterator, Optional
from uuid import uuid4, UUID

from backend.providers.base import (
    AgentProvider,
    CostUpdate,
    StreamEvent,
    TextDelta,
    ToolCallComplete,
    ToolCallDelta,
    ToolCallStart,
    TurnComplete,
)

logger = logging.getLogger(__name__)


class _SessionState:
    """Tracks per-session state for the Claude Code CLI."""

    def __init__(
        self,
        model: str,
        system_prompt: Optional[str] = None,
        cwd: Optional[str] = None,
    ):
        self.model = model
        self.system_prompt = system_prompt
        self.cwd = cwd
        self.started = False  # True after first message has been sent
        self.proc: Optional[asyncio.subprocess.Process] = None


class ClaudeCodeProvider(AgentProvider):
    provider_id = "claude-code"
    display_name = "Claude Code"
    manages_own_tools = True

    def __init__(self, registry: "MCPRegistry | None" = None) -> None:
        from backend.mcp.registry import MCPRegistry
        self._sessions: dict[str, _SessionState] = {}
        self._registry: MCPRegistry | None = registry

    async def start_session(
        self,
        session_id: str,
        model: str,
        system_prompt: Optional[str] = None,
        cwd: Optional[str] = None,
    ) -> None:
        self._sessions[session_id] = _SessionState(
            model=model, system_prompt=system_prompt, cwd=cwd
        )

    async def send_message(
        self, session_id: str, content: str
    ) -> AsyncIterator[StreamEvent]:
        state = self._sessions.get(session_id)
        if state is None:
            raise ValueError(f"Session {session_id} not initialized")

        cmd = [
            "claude", "-p",
            "--output-format", "stream-json",
            "--verbose", "--include-partial-messages",
        ]

        # Build allowed tools list from all enabled MCP servers
        allowed_tools = self._get_allowed_tools()
        if allowed_tools:
            cmd.extend(["--allowedTools"] + allowed_tools)

        if state.model:
            cmd.extend(["--model", state.model])

        if state.system_prompt:
            cmd.extend(["--system-prompt", state.system_prompt])

        # Claude CLI requires UUID with hyphens
        cli_session_id = str(UUID(session_id)) if len(session_id) == 32 else session_id

        if state.started:
            cmd.extend(["--resume", cli_session_id])
        else:
            cmd.extend(["--session-id", cli_session_id])
            state.started = True

        # The prompt text MUST come before --mcp-config since
        # --mcp-config is variadic and consumes all remaining positional args.
        cmd.append(content)

        # Inject invoke_agent MCP server
        mcp_config = self._build_mcp_config(session_id)
        if mcp_config:
            cmd.extend(["--mcp-config", mcp_config])

        backend_port = os.environ.get("AGENTCANVAS_PORT", "8325")
        env = {
            **os.environ,
            "AGENTCANVAS_BACKEND_URL": f"http://127.0.0.1:{backend_port}",
            "AGENTCANVAS_PARENT_SESSION_ID": session_id,
        }

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=state.cwd,
            env=env,
        )
        state.proc = proc

        # Track active content blocks by index so we can map deltas correctly
        active_blocks: dict[int, dict] = {}
        current_message_id = uuid4().hex

        try:
            assert proc.stdout is not None
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break

                line_str = line.decode("utf-8", errors="replace").strip()
                if not line_str:
                    continue

                try:
                    data = json.loads(line_str)
                except json.JSONDecodeError:
                    logger.debug("Non-JSON line from claude CLI: %s", line_str)
                    continue

                msg_type = data.get("type")

                if msg_type == "system" and data.get("subtype") == "init":
                    # Session initialisation — nothing to emit
                    continue

                if msg_type == "stream_event":
                    event = data.get("event", {})
                    event_type = event.get("type")
                    index = event.get("index", 0)

                    if event_type == "content_block_start":
                        block = event.get("content_block", {})
                        block_type = block.get("type")
                        active_blocks[index] = block

                        if block_type == "tool_use":
                            yield ToolCallStart(
                                message_id=current_message_id,
                                tool_call_id=block.get("id", uuid4().hex),
                                tool_name=block.get("name", ""),
                            )

                    elif event_type == "content_block_delta":
                        delta = event.get("delta", {})
                        delta_type = delta.get("type")

                        if delta_type == "text_delta":
                            yield TextDelta(
                                message_id=current_message_id,
                                text=delta.get("text", ""),
                            )
                        elif delta_type == "input_json_delta":
                            block = active_blocks.get(index, {})
                            yield ToolCallDelta(
                                message_id=current_message_id,
                                tool_call_id=block.get("id", ""),
                                partial_json=delta.get("partial_json", ""),
                            )

                    elif event_type == "content_block_stop":
                        block = active_blocks.pop(index, {})
                        if block.get("type") == "tool_use":
                            # Reconstruct full arguments from accumulated partials
                            yield ToolCallComplete(
                                message_id=current_message_id,
                                tool_call_id=block.get("id", ""),
                                tool_name=block.get("name", ""),
                                arguments=block.get("input", {}),
                            )

                elif msg_type == "assistant":
                    # Full assistant message — generate a new message id for the
                    # next turn if the agent loops (tool_use -> continues).
                    current_message_id = uuid4().hex

                elif msg_type == "result":
                    subtype = data.get("subtype", "success")
                    cost = data.get("total_cost_usd", 0.0)
                    usage = data.get("usage", {})

                    yield CostUpdate(
                        cost_usd=cost,
                        input_tokens=usage.get("input_tokens", 0),
                        output_tokens=usage.get("output_tokens", 0),
                    )

                    if subtype == "error":
                        yield TurnComplete(
                            stop_reason="error",
                            error=data.get("error", "Unknown error"),
                        )
                    else:
                        yield TurnComplete(stop_reason="end_turn")

            # Wait for process to finish
            await proc.wait()

            # Check stderr for errors
            if proc.returncode and proc.returncode != 0 and proc.stderr:
                stderr = await proc.stderr.read()
                err_text = stderr.decode("utf-8", errors="replace").strip()
                if err_text:
                    logger.error("Claude CLI error (rc=%d): %s", proc.returncode, err_text)
                    yield TurnComplete(stop_reason="error", error=err_text)

        finally:
            state.proc = None

    # Make the class usable as `async for event in provider.send_message(...)`
    send_message.__doc__ = AgentProvider.send_message.__doc__  # type: ignore[attr-defined]

    def _build_mcp_config(self, session_id: str) -> str:
        """Create a temporary MCP config JSON file with all enabled MCP servers."""
        mcp_servers: dict[str, dict] = {}

        # Built-in: agentcanvas invoke_agent server
        server_script = Path(__file__).parent.parent / "mcp" / "invoke_agent_server.py"
        if server_script.exists():
            mcp_servers["agentcanvas"] = {
                "command": sys.executable,
                "args": [str(server_script)],
            }

        # Add all enabled user-configured stdio MCP servers
        if self._registry:
            from backend.mcp.registry import _sanitize_name
            for server in self._registry.get_enabled_servers():
                if server.transport == "stdio" and server.command:
                    name = _sanitize_name(server.name)
                    entry: dict = {
                        "command": server.command,
                        "args": server.args,
                    }
                    if server.env:
                        entry["env"] = server.env
                    mcp_servers[name] = entry

        if not mcp_servers:
            return ""

        config = {"mcpServers": mcp_servers}
        config_path = Path(tempfile.gettempdir()) / f"agentcanvas-mcp-{session_id}.json"
        config_path.write_text(json.dumps(config))
        return str(config_path)

    def _get_allowed_tools(self) -> list[str]:
        """Build list of tools to pass to --allowedTools."""
        from backend.mcp.permissions import get_policy

        allowed = ["mcp__agentcanvas__invoke_agent"]

        if self._registry:
            from backend.mcp.registry import _sanitize_name
            for tool in self._registry.get_all_tools():
                claude_name = f"mcp__{tool.server_name}__{tool.name}"
                policy = get_policy(tool.qualified_name)
                if policy == "always_allow":
                    allowed.append(claude_name)

        return allowed

    async def stop_session(self, session_id: str) -> None:
        state = self._sessions.pop(session_id, None)
        if state and state.proc and state.proc.returncode is None:
            try:
                state.proc.terminate()
                await asyncio.wait_for(state.proc.wait(), timeout=5.0)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    state.proc.kill()
                except ProcessLookupError:
                    pass

    async def list_models(self) -> list[dict]:
        return [
            {"id": "sonnet", "name": "Claude Sonnet"},
            {"id": "opus", "name": "Claude Opus"},
            {"id": "haiku", "name": "Claude Haiku"},
        ]
