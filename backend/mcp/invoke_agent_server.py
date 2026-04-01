#!/usr/bin/env python3
"""Stdio MCP server that exposes invoke_agent as a tool for Claude Code.

This runs as a subprocess spawned by the Claude Code provider.
It communicates with the AgentCanvas backend via HTTP to invoke sub-agents.
"""

import json
import sys
import os

BACKEND_URL = os.environ.get("AGENTCANVAS_BACKEND_URL", "http://127.0.0.1:8325")
PARENT_SESSION_ID = os.environ.get("AGENTCANVAS_PARENT_SESSION_ID", "")


def send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


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
                    "serverInfo": {"name": "agentcanvas-invoke", "version": "0.1.0"},
                },
            })

        elif method == "notifications/initialized":
            pass  # No response needed

        elif method == "tools/list":
            send({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "tools": [
                        {
                            "name": "invoke_agent",
                            "description": (
                                "Invoke a sub-agent to handle a task. The sub-agent will run to completion "
                                "and return its response. Use this to delegate work to specialized agents. "
                                "Available providers: 'ollama' (local LLM), 'claude-code' (Claude)."
                            ),
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "provider_id": {
                                        "type": "string",
                                        "description": "Provider to use: 'ollama' or 'claude-code'",
                                    },
                                    "model": {
                                        "type": "string",
                                        "description": "Model name (e.g. 'qwen3:4b' for ollama, 'haiku' for claude-code)",
                                    },
                                    "message": {
                                        "type": "string",
                                        "description": "The task/message to send to the sub-agent",
                                    },
                                    "system_prompt": {
                                        "type": "string",
                                        "description": "Optional system prompt for the sub-agent",
                                    },
                                },
                                "required": ["provider_id", "model", "message"],
                            },
                        }
                    ]
                },
            })

        elif method == "tools/call":
            params = request.get("params", {})
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {})

            if tool_name == "invoke_agent":
                try:
                    import urllib.request

                    payload = json.dumps({
                        "provider_id": arguments["provider_id"],
                        "model": arguments["model"],
                        "message": arguments["message"],
                        "parent_session_id": PARENT_SESSION_ID,
                        "system_prompt": arguments.get("system_prompt"),
                    }).encode()

                    req = urllib.request.Request(
                        f"{BACKEND_URL}/api/agents/invoke",
                        data=payload,
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )

                    with urllib.request.urlopen(req, timeout=300) as resp:
                        result = json.loads(resp.read().decode())

                    response_text = result.get("response", "")
                    cost = result.get("cost_usd", 0)
                    sid = result.get("session_id", "")

                    send({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": (
                                        f"**Sub-agent result** (session: {sid}, cost: ${cost:.4f})\n\n"
                                        f"{response_text}"
                                    ),
                                }
                            ]
                        },
                    })

                except Exception as e:
                    send({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [{"type": "text", "text": f"Error invoking agent: {e}"}],
                            "isError": True,
                        },
                    })
            else:
                send({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
                })

        elif req_id is not None:
            send({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Unknown method: {method}"},
            })


if __name__ == "__main__":
    main()
