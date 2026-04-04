# AgentSwarm — Design Document

A provider-agnostic AI agent orchestrator with a spatial canvas interface.
Inspired by [OpenSwarm](https://github.com/openswarm-ai/openswarm), rebuilt from scratch to support CLI-based agents (Claude Code) and API-based agents (Ollama) as first-class citizens.

---

## Motivation

OpenSwarm is an impressive local agent orchestrator, but it has fundamental limitations that prevent it from serving our use case:

- **Hard Anthropic API key dependency** — requires a paid API key; no support for Claude Max (CLI-based) usage
- **No alternative provider support** — no Ollama, OpenAI, or other LLM backends
- **Tightly coupled to Anthropic SDK** — the agent loop, tool execution, and streaming all depend on `claude-agent-sdk`
- **macOS-only desktop app** — Electron wrapper with macOS code signing; no Linux support
- **Heavy runtime** — bundles standalone Python 3.13 via python-build-standalone

AgentSwarm (working name: AgentCanvas) takes the best ideas from OpenSwarm and rebuilds them with a pluggable provider architecture, lighter footprint, and cross-platform support.

---

## What OpenSwarm Does Well (Features Worth Adopting)

### Spatial Canvas
- Infinite canvas with drag-and-drop agent cards
- Pan, zoom, multi-select (shift+drag box selection)
- Multiple dashboards for different workspaces
- Cards: agent cards, view/output cards, browser automation cards
- Connection lines showing parent-child agent relationships

### Agent System
- Real-time streaming chat via WebSocket
- Cost tracking per session (live USD display)
- Session persistence to JSON files (survives restarts)
- Sub-agent spawning (agents fork child agents)
- Git worktree isolation per agent (prevents branch conflicts)

### Human-in-the-Loop
- Per-tool permission policies: `always_allow`, `ask`, `deny`
- Approval requests surface in a unified dashboard view
- Batch approve/deny across all agents with keyboard shortcuts

### Message Branching
- Edit any prior message to fork the conversation
- Navigate between branches without losing context
- Branch switching and parallel conversation exploration

### MCP Integration
- Configure MCP servers (stdio, HTTP, SSE)
- Automatic tool discovery via JSON-RPC
- Community MCP registry browser with GitHub star counts
- Google Workspace OAuth integration (Gmail, Calendar, Drive)

### Templates & Skills
- Reusable prompt templates with structured input fields
- Slash command invocation (`/template-name` in chat)
- Skills library synced to `~/.claude/skills/`
- Skills marketplace browser

### Agent Modes
- Five built-in modes: Agent, Ask, Plan, View Builder, Skill Builder
- Custom user-defined modes with configurable system prompts and tool restrictions

### Other Notable Features
- Diff viewer for uncommitted changes in agent worktrees
- View/output cards with iframe rendering (vibe coding)
- Backend Python execution for output artifacts
- Keyboard shortcuts (D=dashboard, T=templates, 1-9=agents, Shift+A=approve all)
- Dark and light themes

---

## What We Built (AgentCanvas — Phases 1-3)

### Architecture
- **Backend**: FastAPI (Python), WebSocket streaming, JSON file persistence
- **Frontend**: React 19 + TypeScript + Redux Toolkit + Vite
- **Communication**: REST API + WebSocket (`/ws/dashboard`, `/ws/agents/{session_id}`)
- **Storage**: `~/.local/share/agentcanvas/` (sessions, dashboards, MCP configs, permissions)
- **Dev environment**: Nix flake for reproducible setup

### Provider System (Phase 1)
- Abstract `AgentProvider` interface: `start_session()`, `send_message()`, `stop_session()`, `list_models()`, `is_healthy()`
- **Claude Code Provider**: spawns `claude -p` CLI subprocess with `--output-format stream-json`, parses streaming events, manages session continuity via `--resume`
- **Ollama Provider**: HTTP client for `/v1/chat/completions` (OpenAI-compatible), implements agentic tool loop (up to 10 iterations)
- Provider registry with singleton pattern

### Streaming Events
- `TextDelta` — incremental text from assistant
- `ToolCallStart` / `ToolCallDelta` / `ToolCallComplete` — tool execution lifecycle
- `CostUpdate` — token counts and USD cost
- `TurnComplete` — end of agent turn with stop reason

### Spatial Canvas (Phase 1)
- Zoom (Alt+scroll, 0.15x to 3x), pan (middle-click or background drag)
- Dot grid background that scales with zoom
- Agent cards: draggable header, 8-direction resize handles, status dot with glow animation
- Collapsed preview (markdown-rendered last message) and expanded chat view
- Connection lines: bezier curves with automatic port selection, arrowheads, multi-layer glow

### MCP Tool Integration (Phase 2)
- MCP server CRUD (stdio transport, stored as JSON)
- `MCPConnection` class: JSON-RPC 2.0 over stdio subprocess
- `ToolExecutor`: routes tool calls to MCP servers, manages connection pool, handles built-in `invoke_agent`
- Tool discovery and caching per server
- Settings UI for server management and per-tool permission dropdowns
- `invoke_agent` MCP server: stdio server injected into Claude Code for sub-agent spawning

### Permission System (Phase 2)
- Per-tool policies: `always_allow`, `ask`, `deny`
- Heuristic defaults: read/list/get/search tools auto-allow, others require approval
- Human-in-the-loop approval flow using `asyncio.Future` blocking
- Approval bar UI with tool name, expandable JSON arguments, approve/deny buttons

### Multi-Dashboard (Phase 3)
- Dashboard CRUD with per-dashboard JSON storage
- Auto-migration from old single `layout.json` to `dashboards/default.json`
- Dashboard tab switcher in toolbar
- Sessions scoped to dashboards via `dashboard_id`
- Sub-agents inherit parent's `dashboard_id`

### Session History (Phase 3)
- Soft-delete with `closed_at` timestamp (not hard delete)
- History panel with search across session names and message content
- Reopen closed sessions to any dashboard
- Session restore on backend startup (running sessions marked as stopped)

---

## Features Not Yet Built

### High Priority — Core UX

#### Stop Button
- Cancel a running agent from the UI (backend `stop_session()` exists but no prominent UI button)
- Should be visible in the card header when status is "running"

#### Auto-Naming Sessions
- Generate session names from first message content or agent response
- Currently defaults to "Agent" for all sessions
- Could use a cheap LLM call or simple heuristic (first N words of prompt)

#### Keyboard Shortcuts
- Navigate between agents (1-9 by position)
- Approve/deny all pending requests (Shift+A / Shift+D)
- Quick-create agent dialog
- Toggle dashboard/settings/history panels
- Configurable keybindings

#### On-Screen Zoom Controls
- Zoom in/out buttons for users without scroll wheels or trackpads
- Zoom percentage display
- Fit-to-view button (auto-zoom to show all cards)

#### Card Animations
- Smooth transitions when cards are created, moved, or removed
- Framer Motion integration (already a pattern in OpenSwarm)

### Medium Priority — Power Features

#### Message Branching
- Edit prior messages to fork conversations
- Branch navigation UI
- Parallel conversation exploration
- OpenSwarm has this fully implemented — worth studying their approach

#### Git Worktree Isolation
- Each agent gets its own git worktree and branch
- Prevents conflicts when multiple agents modify the same repo
- Diff viewer to inspect uncommitted changes
- Claude Code already supports worktrees; need to wire `cwd` properly

#### Prompt Templates
- Reusable templates with structured input fields
- Slash command invocation in chat (`/template-name`)
- Template library with CRUD
- Could store as JSON or markdown files

#### Agent Modes
- Predefined mode configurations (Agent, Ask, Plan, etc.)
- Custom modes with configurable system prompts and tool restrictions
- Mode selector in agent creation dialog

#### View/Output Cards
- Render HTML/CSS/JS artifacts in sandboxed iframes
- "Vibe coding" — LLM generates the view
- Backend Python execution for data processing
- Input schema validation and data injection

#### Browser Agent Cards
- Embedded browser automation (Playwright-based)
- Tab management, URL display, screenshot preview
- Agents can delegate to browser sub-agents for web tasks

### Lower Priority — Polish

#### Multi-Select & Batch Operations
- Shift+drag to box-select multiple cards
- Move, delete, or resize selections as a group
- Batch approve/deny tool requests

#### Dark/Light Theme Toggle
- Currently hardcoded dark theme
- Design tokens for theme variables
- User preference persistence

#### Settings Page Improvements
- API key management (encrypted storage)
- Provider configuration (Ollama base URL, etc.)
- Canvas preferences (zoom sensitivity, grid size)
- Keyboard shortcut customization

#### MCP Registry Browser
- Browse community MCP servers from the UI
- GitHub star counts and descriptions
- One-click install (auto-configure server)
- Google's official MCP server catalog

#### Skills Library
- Browse and install skills from marketplace
- Sync to `~/.claude/skills/`
- Skill builder mode for creating custom skills

#### Cost Dashboard
- Aggregate cost tracking across all sessions
- Cost breakdown by provider/model
- Budget alerts

#### Session Duplication
- Clone an existing session (with full message history)
- Useful for exploring different approaches from the same starting point

#### Export/Import
- Export sessions as markdown or JSON
- Import sessions from other tools
- Dashboard export/import for sharing layouts

### Architecture — Future Considerations

#### Additional Providers
- **OpenAI-compatible API**: Any provider supporting OpenAI's chat completions format
- **Google Gemini**: Direct API integration
- **Local models**: llama.cpp, vLLM, or other local inference servers
- **Aider**: CLI-based coding agent (similar pattern to Claude Code provider)

#### HTTP/SSE MCP Transport
- Models defined but not wired for HTTP-based MCP servers
- Would allow connecting to remote MCP servers

#### Multi-User Support
- Currently single-user, all state shared globally
- User authentication and session isolation
- Role-based access control for tool permissions

#### Scalable Persistence
- Current JSON file storage has no locking (concurrent write risk)
- SQLite or similar for session/message storage
- Pagination for large message histories

#### Plugin System
- Allow third-party providers, card types, and tools
- Hot-reloadable plugin architecture

---

## Technical Decisions

### Why CLI Agents as First-Class Citizens
Claude Code (the CLI) is the primary way Claude Max subscribers interact with Claude for coding tasks. By spawning `claude -p` as a subprocess and parsing its stream-json output, we get the full Claude Code experience — tool use, context awareness, session continuity — without needing an API key.

### Why Not Fork OpenSwarm
OpenSwarm's architecture is too tightly coupled to the Anthropic SDK to retrofit multi-provider support. The agent loop, tool execution, streaming, and even session management all assume `claude-agent-sdk`. Starting fresh with a provider abstraction layer was cleaner than trying to extract it.

### Why JSON File Persistence
Simple, debuggable, no external dependencies. Good enough for a local single-user tool. Can migrate to SQLite later if concurrent access or query performance becomes an issue.

### Why Redux Over Zustand/Jotai
Redux Toolkit's async thunks, middleware (for WebSocket event dispatch), and DevTools integration are well-suited for the complex state management needed: multiple agent sessions streaming simultaneously, canvas positions, MCP configs, and dashboard state.

### Why Alt+Scroll for Zoom
Ctrl+scroll conflicts with the niri Wayland compositor's built-in zoom. Alt+scroll is available and consistent across compositors. Zoom modifier should be made configurable in settings.

---

## File Structure (Current)

```
agentcanvas/
├── backend/
│   ├── main.py                    # FastAPI app, all REST + WebSocket routes
│   ├── agents/
│   │   ├── models.py              # AgentSession, Message, CardPosition (Pydantic)
│   │   ├── agent_manager.py       # Session lifecycle, streaming, sub-agent spawning
│   │   └── ws_manager.py          # WebSocket connection pool, broadcasting
│   ├── providers/
│   │   ├── base.py                # AgentProvider interface, stream event types
│   │   ├── claude_code.py         # Claude CLI subprocess provider
│   │   ├── ollama.py              # Ollama HTTP provider with agentic loop
│   │   └── registry.py            # Provider + tool executor singletons
│   ├── mcp/
│   │   ├── models.py              # MCPServerConfig, ToolSchema, ToolPermission
│   │   ├── client.py              # MCPConnection (JSON-RPC 2.0 over stdio)
│   │   ├── registry.py            # MCP server config CRUD
│   │   ├── tool_executor.py       # Tool routing, permissions, approval flow
│   │   ├── permissions.py         # Policy storage and heuristic defaults
│   │   └── invoke_agent_server.py # Stdio MCP server for sub-agent spawning
│   └── sessions/
│       └── store.py               # JSON persistence for sessions + dashboards
├── frontend/
│   ├── src/
│   │   ├── index.tsx              # React entry with Redux Provider
│   │   ├── app/
│   │   │   ├── App.tsx            # Main layout, modal state
│   │   │   └── pages/
│   │   │       ├── Canvas/
│   │   │       │   ├── Canvas.tsx     # Spatial viewport, connections SVG
│   │   │       │   ├── AgentCard.tsx  # Draggable/resizable card
│   │   │       │   └── Toolbar.tsx    # Dashboard tabs, agent creation
│   │   │       ├── AgentChat/
│   │   │       │   ├── AgentChat.tsx  # Message list, input, streaming
│   │   │       │   └── ApprovalBar.tsx # HITL approval UI
│   │   │       ├── Settings/
│   │   │       │   └── Settings.tsx   # MCP server management
│   │   │       └── History/
│   │   │           └── History.tsx    # Closed session browser
│   │   └── shared/
│   │       ├── state/
│   │       │   ├── store.ts       # Redux store config
│   │       │   ├── agentsSlice.ts # Agent sessions + history state
│   │       │   ├── canvasSlice.ts # Cards, connections, dashboards
│   │       │   └── mcpSlice.ts    # MCP servers, tools, permissions
│   │       └── ws/
│   │           └── WebSocketManager.ts # WS connection, event dispatch
│   ├── vite.config.ts
│   └── package.json
├── flake.nix                      # Nix dev environment
└── run.sh                         # Dev startup script
```

---

## Data Storage

```
~/.local/share/agentcanvas/
├── sessions/{session_id}.json     # Full session with messages
├── dashboards/{dashboard_id}.json # Dashboard layout + card positions
├── mcp_servers/{server_id}.json   # MCP server configurations
└── permissions.json               # Tool permission policies
```

---

## API Surface

### REST Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check |
| GET | `/api/providers` | List providers |
| GET | `/api/providers/{id}/models` | List models for provider |
| GET | `/api/providers/{id}/health` | Provider health check |
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions?dashboard_id=` | List active sessions |
| GET | `/api/sessions/history?search=` | List closed sessions |
| GET | `/api/sessions/{id}` | Get session |
| DELETE | `/api/sessions/{id}` | Hard delete session |
| POST | `/api/sessions/{id}/stop` | Stop running agent |
| POST | `/api/sessions/{id}/close` | Soft-close session |
| POST | `/api/sessions/{id}/reopen` | Reopen closed session |
| POST | `/api/agents/invoke` | Invoke sub-agent (sync) |
| GET | `/api/mcp-servers` | List MCP servers |
| POST | `/api/mcp-servers` | Create MCP server |
| GET | `/api/mcp-servers/{id}` | Get MCP server |
| PUT | `/api/mcp-servers/{id}` | Update MCP server |
| DELETE | `/api/mcp-servers/{id}` | Delete MCP server |
| GET | `/api/mcp-servers/{id}/tools` | Discover tools |
| GET | `/api/permissions` | Get tool permissions |
| PUT | `/api/permissions` | Set tool permissions |
| GET | `/api/dashboards` | List dashboards |
| POST | `/api/dashboards` | Create dashboard |
| GET | `/api/dashboards/{id}` | Get dashboard |
| PUT | `/api/dashboards/{id}` | Update dashboard |
| DELETE | `/api/dashboards/{id}` | Delete dashboard |
| GET | `/api/dashboards/{id}/layout` | Get card positions |
| PUT | `/api/dashboards/{id}/layout` | Save card positions |

### WebSocket Events
| Event | Direction | Purpose |
|-------|-----------|---------|
| `agent:send_message` | client → server | Send message to agent |
| `agent:stop` | client → server | Stop agent |
| `agent:approval_response` | client → server | Approve/deny tool |
| `agent:status` | server → client | Session status change |
| `agent:message` | server → client | Complete message |
| `agent:stream_start` | server → client | Begin streaming |
| `agent:stream_delta` | server → client | Stream chunk |
| `agent:stream_end` | server → client | End streaming |
| `agent:cost_update` | server → client | Token/cost update |
| `agent:approval_request` | server → client | Tool needs approval |
| `agent:spawned` | server → client | Child agent created |
