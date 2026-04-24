#!/usr/bin/env python3
"""Stdio MCP server that proxies every enabled HTTP MCP server to Claude Code.

Claude Code's ``--mcp-config`` accepts stdio MCP servers natively but OAuth-authenticated
HTTP MCPs live in our registry, not in Claude Code's own config. This shim bridges the two:
Claude Code talks to us over stdio, we forward every tools/list and tools/call to the
AgentCanvas backend, which dispatches through ``HttpMCPConnection`` and handles OAuth,
refresh, and re-auth transparently.

Spawned as a subprocess by ``ClaudeCodeProvider._build_mcp_config`` whenever a session has
``tools_enabled`` and at least one enabled HTTP MCP server exists.
"""

import json
import os
import sys
import urllib.request
from urllib.error import HTTPError, URLError

BACKEND_URL = os.environ.get("AGENTCANVAS_BACKEND_URL", "http://127.0.0.1:8325")


def send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def _list_tools() -> list[dict]:
    req = urllib.request.Request(f"{BACKEND_URL}/api/internal/mcp-proxy/tools")
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode())
    return data.get("tools", [])


def _call_tool(qualified_name: str, arguments: dict) -> tuple[str, bool]:
    payload = json.dumps({
        "qualified_name": qualified_name,
        "arguments": arguments,
    }).encode()
    req = urllib.request.Request(
        f"{BACKEND_URL}/api/internal/mcp-proxy/call",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        # OAuth flows can take a while if the user needs to re-authenticate in the browser.
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = json.loads(resp.read().decode())
        return data.get("content", ""), False
    except HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            j = json.loads(body)
            return f"HTTP {e.code}: {j.get('error', body)}", True
        except json.JSONDecodeError:
            return f"HTTP {e.code}: {body}", True
    except URLError as e:
        return f"Cannot reach AgentCanvas backend at {BACKEND_URL}: {e.reason}", True


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = request.get("method", "")
        req_id = request.get("id")

        if method == "initialize":
            send({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "agentcanvas-http-proxy", "version": "0.1.0"},
                },
            })

        elif method == "notifications/initialized":
            pass

        elif method == "tools/list":
            try:
                tools = _list_tools()
                send({"jsonrpc": "2.0", "id": req_id, "result": {"tools": tools}})
            except Exception as e:
                # Don't crash the shim on discovery failure — Claude Code treats an
                # empty list as "no tools" and moves on.
                send({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"tools": []},
                    "_note": f"proxy discovery failed: {e}",
                })

        elif method == "tools/call":
            params = request.get("params", {})
            qualified_name = params.get("name", "")
            arguments = params.get("arguments", {}) or {}
            text, is_error = _call_tool(qualified_name, arguments)
            result: dict = {"content": [{"type": "text", "text": text}]}
            if is_error:
                result["isError"] = True
            send({"jsonrpc": "2.0", "id": req_id, "result": result})

        elif req_id is not None:
            send({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Unknown method: {method}"},
            })


if __name__ == "__main__":
    main()
