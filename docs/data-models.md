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
| `card_type` | enum | `"agent"` | `agent`, `view`, `input` |
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
| `transform` | string? | null | Template: `{{output}}` for full text, `{{output.field}}` for JSON fields |

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

## DashboardLayout

Canvas state for a single dashboard.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | uuid | Dashboard identifier |
| `name` | string | `"New Canvas"` | Display name |
| `cards` | dict[str, CardPosition] | {} | Card positions keyed by ID |
| `connections` | Connection[] | [] | All connections |
| `groups` | CardGroup[] | [] | All groups |
| `created_at` | float | now | Unix timestamp |
