import asyncio
import json
import logging
import os
from uuid import uuid4
from typing import Any

from backend.mcp.client import MCPConnection
from backend.mcp.models import MCPServerConfig, ToolSchema
from backend.mcp.registry import MCPRegistry

logger = logging.getLogger(__name__)

# Built-in invoke_agent tool in OpenAI function format
INVOKE_AGENT_TOOL = {
    "type": "function",
    "function": {
        "name": "invoke_agent",
        "description": (
            "Invoke a sub-agent to handle a task. The sub-agent runs to completion "
            "and returns its response. Available providers: 'ollama', 'claude-code'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "provider_id": {"type": "string", "description": "Provider: 'ollama' or 'claude-code'"},
                "model": {"type": "string", "description": "Model name"},
                "message": {"type": "string", "description": "Task for the sub-agent"},
            },
            "required": ["provider_id", "model", "message"],
        },
    },
}


class ToolExecutor:
    def __init__(self, registry: MCPRegistry):
        self._registry = registry
        self._connections: dict[str, MCPConnection] = {}  # server_id -> connection
        self._tool_index: dict[str, tuple[str, str]] = {}  # qualified_name -> (server_id, raw_name)
        self._pending_approvals: dict[str, asyncio.Future] = {}  # approval_id -> future

    async def discover_and_cache(self, server_id: str | None = None) -> None:
        """Discover tools from MCP servers and cache them."""
        from backend.mcp.client import discover_tools

        servers = [self._registry.get_server(server_id)] if server_id else self._registry.get_enabled_servers()
        for server in servers:
            if not server:
                continue
            try:
                tools = await discover_tools(server)
                self._registry.set_cached_tools(server.id, tools)
                for tool in tools:
                    self._tool_index[tool.qualified_name] = (server.id, tool.name)
                logger.info("Discovered %d tools from MCP server '%s'", len(tools), server.name)
            except Exception as e:
                logger.warning("Failed to discover tools from '%s': %s", server.name, e)

    async def get_available_tools(self) -> list[dict]:
        """Return all tools in OpenAI function-calling format, including built-ins."""
        # Re-discover if cache is empty
        all_tools = self._registry.get_all_tools()
        if not all_tools and self._registry.get_enabled_servers():
            await self.discover_and_cache()
            all_tools = self._registry.get_all_tools()

        tools = [INVOKE_AGENT_TOOL]

        for tool in all_tools:
            tools.append({
                "type": "function",
                "function": {
                    "name": tool.qualified_name,
                    "description": tool.description or tool.name,
                    "parameters": tool.input_schema or {"type": "object", "properties": {}},
                },
            })

        return tools

    async def execute_tool(
        self, tool_name: str, arguments: dict,
        parent_session_id: str = "", session_id: str = "",
    ) -> str:
        """Execute a tool call with permission checking and optional approval."""
        from backend.mcp.permissions import get_policy
        from backend.agents.ws_manager import ws_manager

        # Built-in invoke_agent is always allowed
        if tool_name == "invoke_agent":
            return await self._execute_invoke_agent(arguments, parent_session_id)

        policy = get_policy(tool_name)

        if policy == "deny":
            return f"Tool '{tool_name}' is denied by policy."

        if policy == "ask" and session_id:
            # Request approval from user
            approval_id = uuid4().hex
            future: asyncio.Future[bool] = asyncio.get_event_loop().create_future()
            self._pending_approvals[approval_id] = future

            await ws_manager.send_to_session(session_id, "agent:approval_request", {
                "session_id": session_id,
                "approval_id": approval_id,
                "tool_name": tool_name,
                "arguments": arguments,
            })

            try:
                approved = await asyncio.wait_for(future, timeout=300.0)
            except asyncio.TimeoutError:
                approved = False
            finally:
                self._pending_approvals.pop(approval_id, None)

            if not approved:
                return f"Tool '{tool_name}' was denied by user."

        # Execute the tool
        entry = self._tool_index.get(tool_name)
        if not entry:
            return f"Unknown tool: {tool_name}"

        server_id, raw_name = entry
        conn = await self._get_connection(server_id)
        if not conn:
            return f"Failed to connect to MCP server for tool: {tool_name}"

        try:
            return await conn.call_tool(raw_name, arguments)
        except Exception as e:
            logger.exception("Tool execution failed: %s", tool_name)
            return f"Tool execution error: {e}"

    def resolve_approval(self, approval_id: str, approved: bool) -> None:
        """Resolve a pending approval request."""
        future = self._pending_approvals.get(approval_id)
        if future and not future.done():
            future.set_result(approved)

    async def _get_connection(self, server_id: str) -> MCPConnection | None:
        """Get an existing connection or create a new one."""
        if server_id in self._connections:
            conn = self._connections[server_id]
            # Check if process is still alive
            if conn._proc and conn._proc.returncode is None:
                return conn
            # Dead connection, remove it
            del self._connections[server_id]

        server = self._registry.get_server(server_id)
        if not server:
            return None

        try:
            conn = MCPConnection(server)
            await conn.connect()
            await conn.initialize()
            self._connections[server_id] = conn
            return conn
        except Exception as e:
            logger.warning("Failed to connect to MCP server '%s': %s", server.name, e)
            return None

    async def _execute_invoke_agent(self, args: dict, parent_session_id: str) -> str:
        """Execute the built-in invoke_agent tool via HTTP to backend."""
        import httpx
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

    async def close_all(self) -> None:
        """Close all active MCP connections."""
        for conn in self._connections.values():
            try:
                await conn.close()
            except Exception:
                pass
        self._connections.clear()

    def get_tool_names(self) -> list[str]:
        """Return all qualified tool names (for permission filtering)."""
        return list(self._tool_index.keys())
