# API Reference

Base URL: `http://localhost:8325` (configurable via `AGENTCANVAS_PORT`)

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Returns `{"status": "ok"}` |

## Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/providers` | List available providers |
| GET | `/api/providers/{id}/models` | List models for a provider |
| GET | `/api/providers/{id}/health` | Check provider health |

## Sessions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions` | Create a new agent session |
| GET | `/api/sessions?dashboard_id=` | List active sessions |
| GET | `/api/sessions/history?search=` | List closed sessions |
| GET | `/api/sessions/{id}` | Get session details |
| GET | `/api/sessions/{id}/last-run` | Aggregated summary of the most recent run on this session (prompt, response, tool calls, tokens, error). Used by the canvas inspector panel. |
| PATCH | `/api/sessions/{id}` | Update session (`name`, `system_prompt`, `tools_enabled`) |
| DELETE | `/api/sessions/{id}` | Hard delete session |
| POST | `/api/sessions/{id}/stop` | Stop a running agent |
| POST | `/api/sessions/{id}/close` | Soft-close (preserves in history) |
| POST | `/api/sessions/{id}/reopen` | Reopen a closed session |

### Create Session

```json
POST /api/sessions
{
  "provider_id": "claude-code",
  "model": "sonnet",
  "name": "My Agent",              // optional, auto-named from first message
  "system_prompt": "You are...",    // optional
  "dashboard_id": "default",       // optional
  "cwd": "/path/to/project",       // optional, enables git worktree
  "mode_id": "agent",              // optional
  "tools_enabled": true             // optional, default true; when false, MCP tools are hidden from this session
}
```

### Update Session

```json
PATCH /api/sessions/{id}
{
  "name": "New Name",
  "system_prompt": "Updated prompt",
  "tools_enabled": false
}
```

`tools_enabled=false` takes effect on the next message: Ollama stops sending the `tools` field to the upstream API, and Claude Code launches without `--mcp-config` (so even its own `invoke_agent` server is hidden).

## Branching

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions/{id}/branch` | Fork conversation after a message |
| POST | `/api/sessions/{id}/switch-branch` | Switch active branch |
| GET | `/api/sessions/{id}/branches` | List all branches |

### Fork Conversation

```json
POST /api/sessions/{id}/branch
{
  "fork_after_message_id": "abc123",
  "content": "New message on the fork"
}
```

## Input Cards

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/input-cards` | Create input card |
| GET | `/api/input-cards?dashboard_id=` | List input cards |
| GET | `/api/input-cards/{id}` | Get input card |
| PUT | `/api/input-cards/{id}` | Update input card |
| DELETE | `/api/input-cards/{id}` | Delete input card |
| POST | `/api/input-cards/{id}/send` | Send content from chat mode |
| POST | `/api/input-cards/{id}/webhook` | Receive webhook data |

### Create Input Card

```json
POST /api/input-cards
{
  "name": "My Input",
  "source_type": "chat",           // "chat" | "webhook" | "file"
  "config": {},                    // {"path": "/tmp/watch.txt"} for file mode
  "dashboard_id": "default"
}
```

### Send via Chat

```json
POST /api/input-cards/{id}/send
{
  "content": "Tell me about cats"
}
```

### Webhook

```json
POST /api/input-cards/{id}/webhook
{
  "content": "Data from external system"
}
```

Accepts `content`, `text`, or `data` fields. Objects/arrays are JSON-serialized.

## View Cards

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/view-cards` | Create view card |
| GET | `/api/view-cards?dashboard_id=` | List view cards |
| GET | `/api/view-cards/{id}` | Get view card |
| PUT | `/api/view-cards/{id}` | Update view card |
| DELETE | `/api/view-cards/{id}` | Delete view card |

## Gate Cards

Arbiter cards that collect outputs from multiple upstream connections and resolve them via an LLM call. See [Gate Cards](workflows.md#gate-cards).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/gate-cards` | Create gate card |
| GET | `/api/gate-cards?dashboard_id=` | List gate cards |
| GET | `/api/gate-cards/{id}` | Get gate card |
| PUT | `/api/gate-cards/{id}` | Update gate card (name, mode, provider, model) |
| DELETE | `/api/gate-cards/{id}` | Delete gate card |
| POST | `/api/gate-cards/{id}/reset` | Clear pending inputs and resolved output |

### Create Gate Card

```json
POST /api/gate-cards
{
  "name": "Decision Gate",
  "mode": "resolve",                 // "resolve" | "synthesize"
  "provider_id": "ollama",
  "model": "qwen3:4b",
  "dashboard_id": "default"
}
```

## Dashboards

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboards` | List dashboards |
| POST | `/api/dashboards` | Create dashboard |
| GET | `/api/dashboards/{id}` | Get dashboard metadata |
| PUT | `/api/dashboards/{id}` | Update dashboard |
| DELETE | `/api/dashboards/{id}` | Delete dashboard |
| GET | `/api/dashboards/{id}/layout` | Get layout (cards, connections, groups, constraints) |
| PUT | `/api/dashboards/{id}/layout` | Save layout (cards, connections, groups, constraints) |
| POST | `/api/dashboards/{id}/invoke` | Synchronously invoke a workflow via webhook (see below) |

The layout payload accepts an optional top-level `constraints` field — a free-text string injected into all routed messages. See [Workflow-level Shared Constraints](workflows.md#workflow-level-shared-constraints).

### Synchronous workflow invocation

`POST /api/dashboards/{dashboard_id}/invoke` makes any AgentCanvas workflow callable as a single HTTP request. The caller specifies an input card to feed and an output (view) card to read from; the request blocks until the workflow produces content on that view card or times out.

```json
POST /api/dashboards/{dashboard_id}/invoke
{
  "input_card_id": "abc123…",
  "output_card_id": "def456…",
  "content": "summarize this article: …",
  "timeout": 60
}
```

Response:

```json
{ "content": "<final view card content>" }
```

- `content` may be a string or a JSON object — objects are stringified before routing.
- `timeout` is in seconds; default 60. Returns 504 with `{"error": "..."}` if the workflow does not produce output on the named view card within that window.
- Both cards must belong to the dashboard. The endpoint registers an in-process future and resolves it the moment routing delivers content to the named view card; concurrent invocations are independent and isolated by their distinct futures.
- This endpoint exists to make agentcanvas callable from external orchestrators (NiFi, n8n, cron, scripts) without long-polling.

## Sub-Agent Invocation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents/invoke` | Invoke a sub-agent synchronously |

```json
POST /api/agents/invoke
{
  "provider_id": "ollama",
  "model": "qwen3:4b",
  "message": "Summarize this",
  "parent_session_id": "abc123",   // optional
  "system_prompt": "You are...",   // optional
  "dashboard_id": "default",       // optional, attaches sub-agent to a dashboard
  "silent": false                  // optional, suppresses agent:spawned broadcast
}
```

Returns the sub-agent's response, cost, and session ID.

## MCP Servers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/mcp-servers` | List configured servers |
| POST | `/api/mcp-servers` | Add a server |
| GET | `/api/mcp-servers/{id}` | Get server config |
| PUT | `/api/mcp-servers/{id}` | Update server |
| DELETE | `/api/mcp-servers/{id}` | Delete server |
| GET | `/api/mcp-servers/{id}/tools` | Discover available tools |

### Add MCP Server (stdio)

```json
POST /api/mcp-servers
{
  "name": "My Server",
  "transport": "stdio",
  "command": "node",
  "args": ["server.js"],
  "env": {"KEY": "value"},
  "enabled": true
}
```

### Add MCP Server (http + OAuth 2.1)

For remote HTTP MCP servers, `transport: "http"` is supported with the Streamable HTTP profile (spec 2025-03-26) and full OAuth 2.1 + PKCE. The server URL, optional static headers, and optional OAuth parameters can all be supplied at creation time:

```json
POST /api/mcp-servers
{
  "name": "affectli-rag",
  "transport": "http",
  "url": "https://dev.affectli.ai/rag/mcp",
  "headers": {},
  "callback_port": 8765,
  "oauth_client_id": "mi-c3.affectli.com",
  "oauth_scopes": ["openid", "offline_access", "profile", "email"],
  "enabled": true
}
```

- `callback_port` — where the local OAuth redirect listener runs; defaults to `8765`. Must match whatever redirect URI the authorization server has registered (for pre-registered clients) or is willing to accept (for dynamically-registered clients).
- `oauth_client_id` — if omitted, the backend performs RFC 7591 dynamic client registration against the advertised `registration_endpoint`. If your authorization server doesn't advertise one, you **must** set `oauth_client_id`.
- `oauth_scopes` — explicit override. Omit to use scopes advertised by the authorization server. For Keycloak, include `offline_access` so refresh tokens are issued.

### Discover Tools

```
GET /api/mcp-servers/{id}/tools
```

Returns the list of discovered tools. For HTTP servers, this endpoint:

1. Opens a connection and sends the MCP `initialize` handshake.
2. On `401 Unauthorized`, triggers the OAuth flow: reads `WWW-Authenticate: Bearer resource_metadata=...`, fetches `.well-known/oauth-protected-resource` and `.well-known/oauth-authorization-server`, dynamically registers (or reuses `oauth_client_id`), opens the user's browser to the authorization endpoint with PKCE, listens on `http://localhost:{callback_port}/callback` for the redirect, exchanges the code for tokens, persists them on the server config, and retries.
3. Returns `{"tools": [...]}` on success or `{"error": "<message>"}` with HTTP 502 on failure (auth denied, network error, incompatible server, etc.).

Tokens are refreshed transparently on subsequent calls when `expires_at` is within 30 seconds. Refresh failures invalidate the stored tokens and the next discovery will re-trigger the interactive flow.

## Dialogue Cards

Multi-turn orchestrator-driven exchanges between N participants. See the [workflows doc](workflows.md#dialogue-cards) for the conceptual model.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/dialogue-cards` | Create dialogue card |
| GET | `/api/dialogue-cards?dashboard_id=` | List cards (optionally scoped) |
| GET | `/api/dialogue-cards/{id}` | Get card (includes transcript + final_output) |
| PUT | `/api/dialogue-cards/{id}` | Update (name, participants, max_turns, termination_rule, initial_prompt, output_mode) |
| DELETE | `/api/dialogue-cards/{id}` | Delete card |
| POST | `/api/dialogue-cards/{id}/start` | Run the loop with the configured initial_prompt (no upstream trigger needed) |
| POST | `/api/dialogue-cards/{id}/reset` | Clear transcript and final output |

```json
POST /api/dialogue-cards
{
  "name": "Code review council",
  "participants": [
    {
      "role": "orchestrator",
      "name": "Chair",
      "description": "",
      "provider_id": "claude-code",
      "model": "sonnet",
      "system_prompt": "You chair a panel of language specialists…",
      "tools_enabled": true,
      "context_mode": "full"
    },
    {
      "role": "worker",
      "name": "Python",
      "description": "Python 3, async, typing",
      "provider_id": "ollama",
      "model": "qwen3:4b",
      "system_prompt": "You are a senior Python engineer.",
      "tools_enabled": false,
      "context_mode": "question_only"
    }
  ],
  "max_turns": 20,
  "termination_rule": "contains:CONSENSUS",
  "initial_prompt": "Review this PR and decide whether to merge.",
  "output_mode": "last_message",
  "dashboard_id": "default"
}
```

Progress is broadcast over the dashboard WebSocket as `dialogue_card:update` events with the full card body.

## Permissions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/permissions` | Get all tool policies |
| PUT | `/api/permissions` | Set policies in bulk |

```json
PUT /api/permissions
{
  "permissions": {
    "server__tool_name": "always_allow"   // "always_allow" | "ask" | "deny"
  }
}
```

## App Settings

Stored server-side in `~/.local/share/agentcanvas/settings.json`. Covers API keys and provider configuration. Canvas preferences and keyboard shortcut bindings are frontend-only (`localStorage`) and are not exposed via this API.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get provider config and masked API key fingerprints |
| PUT | `/api/settings` | Update provider config and/or API keys; re-initialises providers |

```json
GET /api/settings
{
  "provider_config": { "ollama_base_url": "http://localhost:11434" },
  "api_keys_set": { "anthropic": "sk-a…1b2c" }  // masked, read-only
}
```

```json
PUT /api/settings
{
  "provider_config": { "ollama_base_url": "http://ollama.lan:11434" },
  "api_keys": {
    "anthropic": "sk-ant-…",   // non-empty sets/updates the key
    "openai": ""                // empty string clears it
  }
}
```

On save, API keys are also exported as `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in the backend process so provider SDKs pick them up. Keys are stored as plaintext JSON — treat the data directory accordingly.

## Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/templates` | List all templates |
| POST | `/api/templates` | Create template |
| GET | `/api/templates/{id}` | Get template by ID |
| GET | `/api/templates/by-slug/{slug}` | Get template by slug |
| PUT | `/api/templates/{id}` | Update template |
| DELETE | `/api/templates/{id}` | Delete template |

## Modes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/modes` | List all modes |
| POST | `/api/modes` | Create mode |
| GET | `/api/modes/{id}` | Get mode |
| PUT | `/api/modes/{id}` | Update mode (not builtin) |
| DELETE | `/api/modes/{id}` | Delete mode |

## Command Policies

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/command-policies` | List policies |
| POST | `/api/command-policies` | Create policy |
| PUT | `/api/command-policies/{id}` | Update policy |
| DELETE | `/api/command-policies/{id}` | Delete policy |
| GET | `/api/sessions/{id}/command-audit` | Get command audit log |

## Git Worktree

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/{id}/diff` | Get uncommitted changes |
| GET | `/api/sessions/{id}/git-status` | Get git status |

## WebSocket Events

### Endpoints

| Path | Description |
|------|-------------|
| `/ws/dashboard` | Dashboard-wide broadcast channel |
| `/ws/agents/{session_id}` | Session-specific channel |

### Client -> Server

| Event | Payload | Description |
|-------|---------|-------------|
| `agent:send_message` | `{session_id, content}` | Send message to agent |
| `agent:stop` | `{session_id}` | Stop running agent |
| `agent:approval_response` | `{approval_id, approved}` | Approve/deny tool use |

### Server -> Client

| Event | Payload | Description |
|-------|---------|-------------|
| `agent:status` | `{session_id, status, session?}` | Agent status change |
| `agent:message` | `{session_id, message}` | Complete message added |
| `agent:stream_start` | `{session_id, message_id, role, tool_name?}` | Streaming begins |
| `agent:stream_delta` | `{session_id, message_id, delta}` | Streaming text chunk |
| `agent:stream_end` | `{session_id, message_id}` | Streaming complete |
| `agent:cost_update` | `{session_id, cost_usd, tokens}` | Cost/token update |
| `agent:approval_request` | `{session_id, approval_id, tool_name, arguments}` | Tool needs approval |
| `agent:spawned` | `{session_id, parent_session_id, session}` | Sub-agent created |
| `agent:branch_created` | `{session_id, branch_id, session}` | Conversation forked |
| `agent:branch_switched` | `{session_id, branch_id, session}` | Active branch changed |
| `view_card:update` | `{card_id, card}` | View card content updated |
| `gate_card:update` | `{card_id, card}` | Gate card status/inputs/output updated |
| `flow:routed` | `{from_card_id, to_card_id, connection_id}` | Output routed between cards |
| `flow:blocked` | `{connection_id, from_card_id, to_card_id, gate_rule, reason}` | Connection halted by [circuit breaker](workflows.md#circuit-breakers) |
| `input_card:triggered` | `{card_id, source, path?}` | Input card fired (file/webhook) |
