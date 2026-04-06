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
| PATCH | `/api/sessions/{id}` | Update session (name, system_prompt) |
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
  "mode_id": "agent"               // optional
}
```

### Update Session

```json
PATCH /api/sessions/{id}
{
  "name": "New Name",
  "system_prompt": "Updated prompt"
}
```

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

The layout payload accepts an optional top-level `constraints` field — a free-text string injected into all routed messages. See [Workflow-level Shared Constraints](workflows.md#workflow-level-shared-constraints).

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

### Add MCP Server

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
