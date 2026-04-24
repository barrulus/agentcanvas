"""HTTP MCP client (Streamable HTTP transport, spec 2025-03-26).

POSTs JSON-RPC to the server URL with ``Accept: application/json, text/event-stream``.
Accepts either a JSON response or an SSE stream containing a single JSON-RPC response.
Transparently performs OAuth on 401 and retries.
"""

import json
import logging
import time
from typing import Callable, Optional

import httpx

from backend.mcp.models import MCPServerConfig, ToolSchema
from backend.mcp.oauth import (
    OAuthError,
    _parse_www_authenticate,
    perform_oauth_flow,
    refresh_tokens,
)
from backend.mcp.registry import _sanitize_name

logger = logging.getLogger(__name__)


class HttpAuthRequired(Exception):
    """Signals the caller should run the OAuth flow, then retry."""

    def __init__(self, metadata_url: Optional[str]) -> None:
        super().__init__("Authentication required")
        self.metadata_url = metadata_url


class HttpMCPConnection:
    """HTTP transport MCP client. Supports the Streamable HTTP profile."""

    def __init__(
        self,
        config: MCPServerConfig,
        persist: Optional[Callable[[MCPServerConfig], None]] = None,  # called after token refresh
    ):
        self.config = config
        self.server_name = _sanitize_name(config.name)
        self._request_id = 0
        self._session_id: Optional[str] = None
        self._client: Optional[httpx.AsyncClient] = None
        self._persist = persist
        # parallel to stdio: for compatibility with code that inspects this
        self._proc = None

    async def connect(self) -> None:
        if not self.config.url:
            raise ValueError(f"HTTP MCP server {self.config.name} has no URL")
        self._client = httpx.AsyncClient(timeout=60.0)

    async def close(self) -> None:
        if self._client:
            try:
                await self._client.aclose()
            except Exception:
                pass
        self._client = None

    async def initialize(self) -> dict:
        result = await self._send_request("initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "agentcanvas", "version": "0.1.0"},
        })
        await self._send_notification("notifications/initialized", {})
        return result

    async def list_tools(self) -> list[ToolSchema]:
        result = await self._send_request("tools/list", {})
        out: list[ToolSchema] = []
        for t in result.get("tools", []):
            out.append(ToolSchema(
                name=t["name"],
                qualified_name=f"{self.server_name}__{t['name']}",
                description=t.get("description", ""),
                input_schema=t.get("inputSchema", {}),
                server_id=self.config.id,
                server_name=self.server_name,
            ))
        return out

    async def call_tool(self, tool_name: str, arguments: dict) -> str:
        result = await self._send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments,
        })
        content = result.get("content", [])
        texts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                texts.append(block.get("text", ""))
            elif isinstance(block, str):
                texts.append(block)
        return "\n".join(texts) if texts else json.dumps(result)

    # -- internals --

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-03-26",
        }
        h.update(self.config.headers or {})
        if self.config.oauth_tokens:
            h["Authorization"] = (
                f"{self.config.oauth_tokens.token_type or 'Bearer'} "
                f"{self.config.oauth_tokens.access_token}"
            )
        if self._session_id:
            h["Mcp-Session-Id"] = self._session_id
        return h

    async def _ensure_fresh_token(self) -> None:
        t = self.config.oauth_tokens
        c = self.config.oauth_client
        if not t or not c:
            return
        if not t.expires_at:
            return
        if time.time() < t.expires_at:
            return
        if not t.refresh_token:
            return
        try:
            new = await refresh_tokens(c, t)
            self.config.oauth_tokens = new
            if self._persist:
                self._persist(self.config)
        except OAuthError as e:
            logger.info("Token refresh failed, will trigger re-auth: %s", e)

    async def _send_request(self, method: str, params: dict) -> dict:
        assert self._client
        await self._ensure_fresh_token()

        self._request_id += 1
        body = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        }
        r = await self._client.post(
            self.config.url, json=body, headers=self._headers()
        )

        if r.status_code == 401:
            # capture resource-metadata URL from WWW-Authenticate if present
            www = r.headers.get("www-authenticate") or r.headers.get("WWW-Authenticate")
            meta = _parse_www_authenticate(www).get("resource_metadata") if www else None
            raise HttpAuthRequired(metadata_url=meta)

        if r.status_code >= 400:
            raise RuntimeError(
                f"MCP HTTP error {r.status_code}: {r.text[:400]}"
            )

        # capture session id if server issues one
        sid = r.headers.get("mcp-session-id") or r.headers.get("Mcp-Session-Id")
        if sid and not self._session_id:
            self._session_id = sid

        ctype = (r.headers.get("content-type") or "").lower()
        if ctype.startswith("application/json"):
            resp = r.json()
        elif "text/event-stream" in ctype:
            resp = _parse_single_sse_response(r.text)
        else:
            # Best-effort JSON
            try:
                resp = r.json()
            except Exception:
                raise RuntimeError(f"Unexpected content-type: {ctype}")

        payload: dict
        if isinstance(resp, list):
            payload = {}
            for item in resp:
                if isinstance(item, dict) and item.get("id") == self._request_id:
                    payload = item
                    break
        elif isinstance(resp, dict):
            payload = resp
        else:
            raise RuntimeError(f"Unexpected response shape: {type(resp).__name__}")
        if "error" in payload:
            raise RuntimeError(f"MCP error: {payload['error']}")
        return payload.get("result") or {}

    async def _send_notification(self, method: str, params: dict) -> None:
        assert self._client
        body = {"jsonrpc": "2.0", "method": method, "params": params}
        r = await self._client.post(
            self.config.url, json=body, headers=self._headers()
        )
        # spec: server responds 202 Accepted; we tolerate any 2xx
        if r.status_code >= 300 and r.status_code != 202:
            logger.debug("notification %s → %d", method, r.status_code)


def _parse_single_sse_response(text: str) -> dict:
    """Extract a single JSON-RPC response payload from an SSE stream."""
    data_lines: list[str] = []
    for line in text.splitlines():
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
        elif line == "":
            if data_lines:
                payload = "\n".join(data_lines)
                try:
                    return json.loads(payload)
                except Exception:
                    data_lines = []
                    continue
    if data_lines:
        return json.loads("\n".join(data_lines))
    raise RuntimeError("Empty SSE stream")


async def discover_tools_http(
    config: MCPServerConfig,
    persist: Optional[Callable[[MCPServerConfig], None]] = None,
) -> list[ToolSchema]:
    """Connect, initialize, list tools, and disconnect.

    If authentication is required, runs the OAuth flow (opening a browser),
    persists updated config via ``persist``, and retries once.
    """
    conn = HttpMCPConnection(config, persist=persist)
    try:
        await conn.connect()
        try:
            await conn.initialize()
        except HttpAuthRequired as e:
            client, tokens = await perform_oauth_flow(config, metadata_hint=e.metadata_url)
            config.oauth_client = client
            config.oauth_tokens = tokens
            if persist:
                persist(config)
            # new connection with fresh tokens
            await conn.close()
            conn = HttpMCPConnection(config, persist=persist)
            await conn.connect()
            await conn.initialize()
        return await conn.list_tools()
    finally:
        await conn.close()
