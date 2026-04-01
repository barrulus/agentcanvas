import asyncio
import json
import logging
import os
from typing import Any

from backend.mcp.models import MCPServerConfig, ToolSchema
from backend.mcp.registry import _sanitize_name

logger = logging.getLogger(__name__)

class MCPConnection:
    """A connection to a single MCP server via stdio."""

    def __init__(self, config: MCPServerConfig):
        self.config = config
        self.server_name = _sanitize_name(config.name)
        self._proc: asyncio.subprocess.Process | None = None
        self._request_id = 0

    async def connect(self) -> None:
        """Spawn the MCP server subprocess."""
        if not self.config.command:
            raise ValueError(f"MCP server {self.config.name} has no command")

        env = {**os.environ, **self.config.env}
        self._proc = await asyncio.create_subprocess_exec(
            self.config.command, *self.config.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

    async def initialize(self) -> dict:
        """Perform the MCP initialize handshake."""
        result = await self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "agentcanvas", "version": "0.1.0"},
        })
        # Send initialized notification (no response expected)
        await self._send_notification("notifications/initialized", {})
        return result

    async def list_tools(self) -> list[ToolSchema]:
        """Discover available tools from this server."""
        result = await self._send_request("tools/list", {})
        tools = []
        for t in result.get("tools", []):
            tools.append(ToolSchema(
                name=t["name"],
                qualified_name=f"{self.server_name}__{t['name']}",
                description=t.get("description", ""),
                input_schema=t.get("inputSchema", {}),
                server_id=self.config.id,
                server_name=self.server_name,
            ))
        return tools

    async def call_tool(self, tool_name: str, arguments: dict) -> str:
        """Execute a tool and return the result as text."""
        result = await self._send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments,
        })
        # Extract text from content blocks
        content = result.get("content", [])
        texts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                texts.append(block.get("text", ""))
            elif isinstance(block, str):
                texts.append(block)
        return "\n".join(texts) if texts else json.dumps(result)

    async def close(self) -> None:
        """Terminate the MCP server subprocess."""
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=5.0)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    self._proc.kill()
                except ProcessLookupError:
                    pass
        self._proc = None

    async def _send_request(self, method: str, params: dict) -> dict:
        """Send a JSON-RPC request and wait for the response."""
        assert self._proc and self._proc.stdin and self._proc.stdout

        self._request_id += 1
        request = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        }

        line = json.dumps(request) + "\n"
        self._proc.stdin.write(line.encode())
        await self._proc.stdin.drain()

        # Read response lines until we get one with matching id
        while True:
            resp_line = await asyncio.wait_for(
                self._proc.stdout.readline(), timeout=30.0
            )
            if not resp_line:
                raise ConnectionError(f"MCP server {self.config.name} closed stdout")

            resp_str = resp_line.decode().strip()
            if not resp_str:
                continue

            try:
                resp = json.loads(resp_str)
            except json.JSONDecodeError:
                logger.debug("Non-JSON from MCP server %s: %s", self.config.name, resp_str)
                continue

            # Skip notifications (no id field)
            if "id" not in resp:
                continue

            if resp.get("id") == self._request_id:
                if "error" in resp:
                    raise RuntimeError(f"MCP error: {resp['error']}")
                return resp.get("result", {})

    async def _send_notification(self, method: str, params: dict) -> None:
        """Send a JSON-RPC notification (no response expected)."""
        assert self._proc and self._proc.stdin

        notification = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }

        line = json.dumps(notification) + "\n"
        self._proc.stdin.write(line.encode())
        await self._proc.stdin.drain()


async def discover_tools(config: MCPServerConfig) -> list[ToolSchema]:
    """Connect to an MCP server, discover tools, and disconnect."""
    conn = MCPConnection(config)
    try:
        await conn.connect()
        await conn.initialize()
        tools = await conn.list_tools()
        return tools
    finally:
        await conn.close()
