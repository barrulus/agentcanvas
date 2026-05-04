# Data Models

All models are defined in `backend/agents/models.py` using Pydantic.

## AgentSession

The core model for an agent's state and conversation.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Unique session identifier |
| `name` | string | `""` | Display name (auto-generated from first message) |
| `provider_id` | string | required | `"claude-code"` or `"ollama"` |
| `model` | string | required | Model name (e.g., `"sonnet"`, `"qwen3:4b"`) |
| `status` | enum | `"idle"` | `idle`, `running`, `completed`, `error`, `stopped` |
| `system_prompt` | string? | null | Custom system instructions |
| `tools_enabled` | bool | true | When false, MCP tools are hidden from this session (Ollama drops the `tools` field; Claude Code skips `--mcp-config`) |
| `messages` | Message[] | [] | Conversation history |
| `cost_usd` | float | 0.0 | Accumulated cost in USD |
| `tokens` | dict | `{input: 0, output: 0}` | Token usage |
| `dashboard_id` | string? | null | Which canvas this session belongs to |
| `parent_session_id` | string? | null | Parent session (for sub-agents) |
| `cwd` | string? | null | Working directory |
| `mode_id` | string? | null | Agent mode |
| `worktree_path` | string? | null | Git worktree path (if isolated) |
| `repo_path` | string? | null | Original repository path |
| `active_branch_id` | string? | null | Active conversation branch |
| `branches` | dict[str, BranchInfo] | {} | All conversation branches |
| `created_at` | float | now | Unix timestamp |
| `closed_at` | float? | null | When soft-closed |

## Message

A single message in a conversation.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Unique message ID |
| `role` | enum | required | `user`, `assistant`, `tool_call`, `tool_result`, `system` |
| `content` | any | required | String or structured content |
| `timestamp` | float | now | Unix timestamp |
| `tool_name` | string? | null | Tool name (for tool_call messages) |
| `tool_call_id` | string? | null | Tool call ID (for linking call/result) |
| `parent_id` | string? | null | Parent message in branch tree |
| `branch_id` | string? | null | Which branch this message belongs to |

## CardPosition

Layout position for a card on the canvas.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `session_id` | string | required | Card identifier (session ID, view card ID, or input card ID) |
| `x` | float | 0 | X position on canvas |
| `y` | float | 0 | Y position on canvas |
| `width` | float | 480 | Card width in pixels |
| `height` | float | 280 | Card height in pixels |
| `z_order` | int | 0 | Z-index for layering |
| `card_type` | enum | `"agent"` | `agent`, `view`, `input`, `gate`, `dialogue` |
| `collapsed` | bool | false | Whether card is collapsed to BPMN-style icon |

## Connection

A directed edge between two cards.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Connection identifier |
| `from_card_id` | string | required | Source card ID |
| `to_card_id` | string | required | Target card ID |
| `condition` | string? | null | Routing condition: `contains:text`, `not_contains:text`, `regex:pattern` |
| `output_schema` | dict? | null | JSON Schema for output validation |
| `transform` | string? | null | Template — see [Transform expressions](workflows.md#transform-expressions) for the full grammar |
| `gate_rule` | string? | null | Circuit breaker: `require:text`, `reject:text`, `min_length:N`, `max_length:N` |

## InputCard

Workflow entry point.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Card identifier |
| `name` | string | `"Input"` | Display name |
| `source_type` | enum | `"chat"` | `chat`, `webhook`, `file` |
| `config` | dict | {} | Source-specific config (e.g., `{"path": "/tmp/watch.txt"}`) |
| `dashboard_id` | string? | null | Which dashboard |
| `created_at` | float | now | Unix timestamp |

## ViewCard

Output display card.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Card identifier |
| `name` | string | `"Output"` | Display name |
| `content` | string | `""` | Markdown content |
| `dashboard_id` | string? | null | Which dashboard |
| `created_at` | float | now | Unix timestamp |

## GateCard

Arbiter card that collects multiple upstream outputs and resolves them into one via an LLM call. See [Gate Cards](workflows.md#gate-cards).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Card identifier |
| `name` | string | `"Gate"` | Display name |
| `mode` | enum | `"resolve"` | `resolve` (pick best) or `synthesize` (merge candidates) |
| `provider_id` | string | `""` | Provider for the resolution LLM call |
| `model` | string | `""` | Model for the resolution LLM call |
| `status` | enum | `"idle"` | `idle`, `waiting`, `resolving`, `completed`, `error` |
| `pending_inputs` | dict[str, str] | {} | Buffered upstream outputs keyed by connection ID |
| `resolved_output` | string | `""` | LLM resolution result |
| `dashboard_id` | string? | null | Which dashboard |
| `created_at` | float | now | Unix timestamp |

A gate card auto-triggers resolution once `pending_inputs` covers every incoming connection's ID. Workflow [shared constraints](workflows.md#workflow-level-shared-constraints) are appended to the resolution system prompt.

## DialogueCard

Orchestrator-driven multi-turn exchange between N participants, encapsulated in one card. See [Dialogue Cards](workflows.md#dialogue-cards).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Card identifier |
| `name` | string | `"Dialogue"` | Display name |
| `participants` | DialogueParticipant[] | [] | Ordered list; exactly one should have `role="orchestrator"` |
| `max_turns` | int | 20 | Safety cap on total turns (orchestrator + workers combined) |
| `termination_rule` | string? | null | `contains:X` or `regex:X` — matched against orchestrator output |
| `initial_prompt` | string | `""` | Seed shown to the orchestrator on turn 0 |
| `output_mode` | enum | `"last_message"` | `last_message` (last orchestrator reply, tags stripped) or `full_transcript` |
| `status` | enum | `"idle"` | `idle`, `running`, `completed`, `error` |
| `transcript` | DialogueTurn[] | [] | Full turn-by-turn log |
| `final_output` | string | `""` | What routes downstream on completion |
| `current_speaker` | string? | null | Populated while `status="running"` |
| `dashboard_id` | string? | null | Which dashboard |
| `created_at` | float | now | Unix timestamp |

### DialogueParticipant

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Used as the routing tag (`{{ask:Name}}`) |
| `description` | string | `""` | Injected into the orchestrator's auto-generated roster |
| `role` | enum | `"worker"` | `orchestrator` or `worker` |
| `provider_id` | string | required | Independent per participant |
| `model` | string | required | Independent per participant |
| `system_prompt` | string | `""` | Persona / behaviour |
| `tools_enabled` | bool | true | When false, this participant sees no MCP tools. New workers default to `false`; new orchestrators default to `true` |
| `context_mode` | enum | `"question_only"` | `full`, `last_n`, or `question_only` |
| `context_last_n` | int | 5 | Window size when `context_mode="last_n"` |
| `max_context_tokens` | int? | null | Soft cap on visible transcript (not yet enforced in v1) |

### DialogueTurn

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `speaker` | string | required | Participant name, or `"user"` for the seed prompt |
| `content` | string | required | Turn text |
| `timestamp` | float | now | Unix timestamp |
| `cost_usd` | float | 0.0 | Per-turn cost (where the provider reports one) |

## CardGroup

Visual grouping of cards.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Group identifier |
| `name` | string | `"Group"` | Display name |
| `member_ids` | string[] | [] | Card IDs in this group |
| `collapsed` | bool | false | Whether group is collapsed |
| `color` | string? | null | Border color |

## BranchInfo

Metadata for a conversation branch (fork).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Branch identifier |
| `parent_branch_id` | string? | null | Parent branch |
| `fork_message_id` | string | required | Message where the fork occurred |
| `created_at` | float | now | Unix timestamp |
| `label` | string? | null | Optional branch name |

## MCPServerConfig

Defined in `backend/mcp/models.py`. One file per server under `$XDG_DATA_HOME/agentcanvas/mcp_servers/{id}.json`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Server identifier |
| `name` | string | required | Display name; also used to namespace discovered tools (`{name}__{tool}`) |
| `transport` | enum | `"stdio"` | `stdio` (subprocess, JSON-RPC on stdin/stdout) or `http` (Streamable HTTP, spec 2025-03-26) |
| `command` | string? | null | stdio only — executable (e.g. `"npx"`) |
| `args` | string[] | [] | stdio only — argv |
| `url` | string? | null | http only — e.g. `https://dev.affectli.ai/rag/mcp` |
| `headers` | dict[str, str] | {} | http only — static headers merged into every request (e.g. a fixed Bearer token) |
| `callback_port` | int? | null | http only — port used for the OAuth redirect URI `http://localhost:{port}/callback`. Defaults to 8765 |
| `oauth_client_id` | string? | null | http only — pre-registered OAuth client_id. When set, skips RFC 7591 dynamic registration |
| `oauth_scopes` | string[] | [] | http only — explicit scope override. Include `offline_access` for Keycloak refresh tokens |
| `oauth_client` | OAuthClient? | null | Populated after discovery/registration; cached for refresh |
| `oauth_tokens` | OAuthTokens? | null | Populated after a successful flow; refreshed transparently when expired |
| `env` | dict[str, str] | {} | Extra environment variables for stdio subprocess |
| `enabled` | bool | true | When unchecked, the server is ignored by tool discovery and every agent's tool list |

### OAuthClient

Cached authorization-server metadata and client credentials for a single MCP server.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `authorization_endpoint` | string | required | From `.well-known/oauth-authorization-server` |
| `token_endpoint` | string | required | From `.well-known/oauth-authorization-server` |
| `registration_endpoint` | string? | null | RFC 7591 endpoint if advertised |
| `client_id` | string | required | User-supplied or dynamically registered |
| `client_secret` | string? | null | Populated if dynamic registration returned one; absent for public PKCE clients |
| `scopes_supported` | string[] | [] | As advertised by the issuer |
| `resource` | string? | null | RFC 8707 resource indicator (from RFC 9728 protected-resource metadata) |

### OAuthTokens

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `access_token` | string | required | Sent as `Authorization: {token_type} {access_token}` |
| `refresh_token` | string? | null | Used to auto-refresh before `expires_at` |
| `token_type` | string | `"Bearer"` | |
| `expires_at` | float? | null | Unix timestamp. Client refreshes 30s before expiry |
| `scope` | string? | null | Space-separated scopes actually granted |

### ToolSchema

Discovered tool metadata cached per server (not persisted — rebuilt on each tool-discovery run).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Raw tool name from the MCP server |
| `qualified_name` | string | required | `{server_name}__{name}` — used in permissions and routing |
| `description` | string | `""` | |
| `input_schema` | dict | {} | JSON Schema |
| `server_id` | string | `""` | Owning server |
| `server_name` | string | `""` | Owning server name (sanitized) |

## DashboardLayout

Canvas state for a single dashboard.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Dashboard identifier |
| `name` | string | `"New Canvas"` | Display name |
| `cards` | dict[str, CardPosition] | {} | Card positions keyed by ID |
| `connections` | Connection[] | [] | All connections |
| `groups` | CardGroup[] | [] | All groups |
| `constraints` | string? | null | Workflow-level shared constraints injected into routed messages |
| `created_at` | float | now | Unix timestamp |
