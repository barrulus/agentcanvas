# Architecture

AgentCanvas is a full-stack application with a FastAPI backend and React frontend communicating over REST and WebSocket.

## System Overview

```
                          Browser (:5173)
                              |
                   REST API + WebSocket
                              |
                    FastAPI Backend (:8325)
                    /         |         \
           Providers     MCP Servers     Storage
           /      \          |           (~/.local/share/agentcanvas/)
   Claude Code   Ollama   Tool Executor
   (subprocess)  (HTTP)   (JSON-RPC)
```

## Backend

**Stack:** Python 3.12, FastAPI, Uvicorn, Pydantic, httpx

### Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Main | `backend/main.py` | FastAPI app, all REST + WebSocket endpoints |
| Agent Manager | `backend/agents/agent_manager.py` | Session lifecycle, streaming, output routing |
| Input Manager | `backend/agents/input_manager.py` | Input card lifecycle, file watchers, downstream routing |
| Gate Manager | `backend/agents/gate_manager.py` | Gate (arbiter) card lifecycle, input buffering, LLM resolution |
| WS Manager | `backend/agents/ws_manager.py` | WebSocket connection pool for dashboard + session channels |
| Models | `backend/agents/models.py` | Pydantic models for all data structures |
| Command Policy | `backend/agents/command_policy.py` | CLI command allowlisting and audit logging |
| Store | `backend/sessions/store.py` | JSON file persistence for all entities |
| Claude Code Provider | `backend/providers/claude_code.py` | Spawns `claude -p` subprocess, parses stream-json |
| Ollama Provider | `backend/providers/ollama.py` | HTTP client for Ollama's OpenAI-compatible API |
| Provider Base | `backend/providers/base.py` | Abstract provider interface and streaming event types |
| Provider Registry | `backend/providers/registry.py` | Singleton provider instances and tool executor |
| MCP Client (stdio) | `backend/mcp/client.py` | JSON-RPC 2.0 over subprocess stdin/stdout; also dispatches to the HTTP client for `transport=http` |
| MCP Client (http) | `backend/mcp/http_client.py` | Streamable HTTP transport (MCP spec 2025-03-26): JSON-RPC POST with SSE-or-JSON response, `Mcp-Session-Id`, transparent token refresh |
| MCP OAuth | `backend/mcp/oauth.py` | OAuth 2.1 + PKCE + RFC 7591 dynamic client registration + RFC 9728 protected-resource metadata + local callback listener |
| MCP Registry | `backend/mcp/registry.py` | Server config storage, token persistence, and tool caching |
| Permissions | `backend/mcp/permissions.py` | Tool permission policies (always_allow/ask/deny) |
| Invoke Agent Server | `backend/mcp/invoke_agent_server.py` | Built-in MCP server for sub-agent spawning |
| Modes | `backend/modes/` | Agent mode definitions (Agent, Ask, Plan) |
| Templates | `backend/templates/` | Prompt template system with field definitions |

### Providers

Providers implement the `AgentProvider` abstract base class:

```python
class AgentProvider(ABC):
    provider_id: str
    display_name: str
    manages_own_tools: bool  # True = CLI handles tools, False = backend executes

    async def start_session(session_id, model, system_prompt?, cwd?, tools_enabled?)
    async def send_message(session_id, content) -> AsyncIterator[StreamEvent]
    async def stop_session(session_id)
    async def list_models() -> list[dict]
    async def is_healthy() -> bool
```

**Claude Code** (`manages_own_tools=True`): Spawns a `claude -p` subprocess per message with `--output-format stream-json`. Each message is a fresh, stateless invocation. Workflow agents (those with upstream connections) don't get the `invoke_agent` tool.

**Ollama** (`manages_own_tools=False`): HTTP client to Ollama's `/v1/chat/completions` endpoint. Implements an agentic tool loop (up to 10 iterations) with tool execution delegated to the backend's tool executor.

#### Per-card tool gating

Each `AgentSession` and each `DialogueParticipant` carries a `tools_enabled` flag (default `true`, except newly-added dialogue workers which default to `false`). When false:

- **Ollama** — `send_message` omits the `tools` field from the request body; the model sees no tools and cannot emit tool calls.
- **Claude Code** — the subprocess is launched without `--mcp-config`, so not even the built-in `invoke_agent` server is available for that turn.

The flag is persisted on `AgentSession` and editable via `PATCH /api/sessions/{id}`. For dialogue participants, it is edited in the Configure dialog and applied each time the orchestrator invokes a participant (each turn spawns a fresh sub-agent session inheriting the flag).

### MCP HTTP + OAuth flow

```
┌──────────┐  POST /mcp {initialize}   ┌────────────────┐
│ Http     │ ──────────────────────▶   │ MCP server     │
│ Client   │ ◀── 401 + WWW-Authenticate│                │
└──────────┘                           └────────────────┘
     │
     │  resource_metadata URL
     ▼
┌────────────────────────────────────────────┐
│ .well-known/oauth-protected-resource       │  → authorization_servers[0]
│ .well-known/oauth-authorization-server     │  → auth_endpoint, token_endpoint,
│                                            │    registration_endpoint
└────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────────────┐
│ RFC 7591 dynamic client registration       │  (skipped when oauth_client_id is set)
└────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────────────┐
│ Open browser → authorization_endpoint      │
│   ?client_id=…&code_challenge=…            │
│   &redirect_uri=http://localhost:{port}/…  │
└────────────────────────────────────────────┘
     │  user signs in
     ▼
┌────────────────────────────────────────────┐
│ Local asyncio listener on callback_port    │  → captures code + state
└────────────────────────────────────────────┘
     │
     ▼
┌──────────┐  POST /token {code, verifier}   ┌────────────────┐
│ Http     │ ──────────────────────────────▶ │ Auth server    │
│ Client   │ ◀── {access_token, refresh_…}   │                │
└──────────┘                                 └────────────────┘
     │  persist to $XDG_DATA_HOME/agentcanvas/mcp_servers/{id}.json
     ▼
┌──────────┐  POST /mcp {initialize}  + Bearer
│ Http     │ ──────────────────────▶   (retry)
│ Client   │ ◀── 200 OK → tools/list
└──────────┘
```

Subsequent requests check `expires_at` and silently `refresh_token` 30s before expiry. Refresh failures invalidate stored tokens; the next tool-discovery call re-enters the interactive flow.

### Streaming Events

The provider `send_message()` yields these event types:

| Event | Fields | Description |
|-------|--------|-------------|
| `TextDelta` | message_id, text | Incremental assistant text |
| `ToolCallStart` | message_id, tool_call_id, tool_name | Tool invocation begins |
| `ToolCallDelta` | message_id, tool_call_id, partial_json | Tool arguments streaming |
| `ToolCallComplete` | message_id, tool_call_id, tool_name, arguments | Tool call finalized |
| `TurnComplete` | stop_reason, error? | Agent turn ends |
| `CostUpdate` | cost_usd, input_tokens, output_tokens | Billing update |

## Frontend

**Stack:** React 19, TypeScript, Redux Toolkit, Vite, Framer Motion

### Key Components

| Component | Path | Purpose |
|-----------|------|---------|
| Canvas | `frontend/src/app/pages/Canvas/Canvas.tsx` | Spatial viewport with pan/zoom/connections |
| AgentCard | `frontend/src/app/pages/Canvas/AgentCard.tsx` | Agent card with preview/chat modes |
| InputCardComponent | `frontend/src/app/pages/Canvas/InputCardComponent.tsx` | Input card (chat/webhook/file) |
| ViewCardComponent | `frontend/src/app/pages/Canvas/ViewCardComponent.tsx` | Output display card |
| Toolbar | `frontend/src/app/pages/Canvas/Toolbar.tsx` | Top bar with dashboard tabs, create buttons |
| AgentChat | `frontend/src/app/pages/AgentChat/AgentChat.tsx` | Full chat interface within agent cards |
| ApprovalBar | `frontend/src/app/pages/AgentChat/ApprovalBar.tsx` | Tool approval UI |

### Redux State

| Slice | Key State | Purpose |
|-------|-----------|---------|
| `agents` | sessions, providers, history | Agent session state and streaming |
| `canvas` | cards, connections, groups, dashboards | Canvas layout and visual state |
| `viewCards` | cards | View card content |
| `inputCards` | cards | Input card configs |
| `mcp` | servers, tools | MCP server management |
| `modes` | modes | Agent mode definitions |
| `templates` | templates | Prompt templates |
| `commandPolicies` | policies | CLI command restrictions |

### WebSocket Manager

`frontend/src/shared/ws/WebSocketManager.ts` manages a single WebSocket connection to `/ws/dashboard`. It handles:

- Delta batching via `requestAnimationFrame` for smooth streaming
- Automatic reconnect with 2-second backoff
- Event dispatch to Redux store
- Sub-agent auto-placement near parent cards

## Data Flow

### User sends message to agent
```
User types in AgentChat
  -> wsManager.sendMessage(sessionId, content)
  -> WebSocket "agent:send_message"
  -> agent_manager.send_message()
  -> provider.send_message() (subprocess or HTTP)
  -> StreamEvents yielded back
  -> WebSocket broadcasts to frontend
  -> Redux state updated, UI re-renders
```

### Input card triggers workflow
```
User types in InputCardComponent and clicks Send
  -> POST /api/input-cards/{id}/send
  -> input_manager.send_to_downstream()
  -> clear_downstream() resets all downstream agents
  -> route_to_downstream() with named routing
  -> Each matched agent receives message
  -> Agents complete -> _route_output() chains further
```

### Output routing between agents
```
Agent completes
  -> _route_output() called
  -> Load connections + workflow constraints from dashboard
  -> Extract {{route:Name}} tags if present
  -> Filter connections to matching targets
  -> For each connection:
     -> Evaluate condition (contains/regex)
     -> Validate JSON schema if specified
     -> Apply transform template
     -> Evaluate gate_rule (circuit breaker) — halt + flow:blocked on failure
     -> If target is an agent: prepend workflow constraints, send message
     -> If target is a gate card: gate_manager.receive_input() buffers and auto-resolves when complete
     -> If target is a view card: update content
```

## Storage

All data persists as JSON files in `~/.local/share/agentcanvas/` (respects `XDG_DATA_HOME`):

```
~/.local/share/agentcanvas/
  sessions/{id}.json          # Agent session state + messages
  dashboards/{id}.json        # Layout: card positions, connections, groups, constraints
  input_cards/{id}.json       # Input card configs
  view_cards/{id}.json        # View card content
  gate_cards/{id}.json        # Gate (arbiter) card state and resolved output
  dialogue_cards/{id}.json    # Dialogue card configs + transcripts + final output
  mcp_servers/{id}.json       # MCP server configurations
  templates/{id}.json         # Custom prompt templates
  modes/{id}.json             # Custom agent modes
  permissions.json            # Tool permission policies
  settings.json               # API keys + provider config (Ollama base URL)
```

Canvas UI preferences (zoom sensitivity, grid size) and keyboard shortcut bindings are stored per-browser in `localStorage` under `agentcanvas.canvasPrefs` / `agentcanvas.shortcuts`.

No database required. Files are read/written atomically via Python's `pathlib`.
