# Getting Started

## Prerequisites

- Python 3.11+
- Node.js 20+
- One or both providers:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command) -- works with Claude Max, no API key needed
  - [Ollama](https://ollama.com/) running locally on port 11434

Optional: [Nix](https://nixos.org/) for a reproducible dev environment.

## Installation

```bash
git clone https://github.com/barrulus/agentcanvas.git
cd agentcanvas
```

### With Nix (recommended)

```bash
nix develop
./run.sh
```

### Without Nix

**Backend:**
```bash
pip install fastapi uvicorn pydantic httpx python-dotenv websockets
```

**Frontend:**
```bash
cd frontend
npm install
```

**Run both:**
```bash
# Terminal 1: Backend
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8325 --reload

# Terminal 2: Frontend
cd frontend
npm run dev
```

Or use the included `run.sh` script which starts both with colored output.

Open **http://localhost:5173** in your browser.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTCANVAS_PORT` | `8325` | Backend port |
| `XDG_DATA_HOME` | `~/.local/share` | Data storage root |

Further configuration happens in **Settings** (press `s` or click the gear icon). The tabbed settings page covers:

- **Providers & API keys** — Anthropic / OpenAI API keys (stored locally in `settings.json`, applied as env vars) and the Ollama base URL
- **MCP Servers** — add and configure MCP stdio/http servers
- **Command Policies** — allow/deny/ask rules for shell commands agents may run
- **Canvas** — zoom sensitivity, grid size, and an experimental **Light mode** toggle (stored in browser `localStorage`). Light mode is a quick CSS-filter hack (`invert + hue-rotate`) with a counter-invert rule for images/video — not a designed theme. Enable it when the dark UI is painful in bright light; expect some accents (cyan, amber) to land in weaker spots of the complement. A real theme system is planned for later.
- **Shortcuts** — click-to-record rebinding for the shortcuts listed below

## Your First Agent

1. Click **"+ New Agent"** in the top-right toolbar
2. Select a provider (Claude Code or Ollama)
3. Choose a model
4. Type an initial message (or leave empty to create an idle agent)
5. Click **"Create & Send"** (or **"Create"** if no message)

The agent card appears on the canvas. You can:
- **Drag** the header to move it
- **Resize** by dragging edges/corners
- **Double-click** the content area to open full chat view
- **Double-click** the header to collapse to a compact icon

## Connecting Agents

1. Hover over a card to see port circles (cyan dots) on each edge
2. Click and drag from a port on one card to a port on another
3. The connection line appears with an arrow showing direction
4. Right-click a connection to edit its data contract (conditions, transforms, schemas)

## Building a Workflow

See [Workflow Orchestration](workflows.md) for a complete guide. Quick steps:

1. Click **"+ Input Card"** -> select "Chat Input"
2. Create agents without initial messages (click "Create")
3. Connect: Input Card -> Agent A -> Agent B -> View Card
4. Type in the Input Card and click Send

## Managing Dashboards

Dashboards are the separate canvases listed as tabs in the top toolbar.

- **Create:** click the `+` button next to the tabs.
- **Switch:** click a tab.
- **Rename / Delete:** right-click a tab for a context menu. Rename opens a prompt; Delete confirms first and then switches to the next remaining dashboard. The last dashboard cannot be deleted — create another one first. Deleting a dashboard removes its layout (card positions, connections, groups, constraints); the individual sessions and cards live in the session history and remain accessible.

## Keyboard Shortcuts

All single-key and modifier shortcuts below (except the fixed `1–9` agent focus and `Alt+Scroll` zoom) can be rebound in **Settings → Shortcuts**.

| Key | Action |
|-----|--------|
| `1-9` | Focus agent card by position |
| `n` | Toggle new agent dialog |
| `s` | Toggle settings |
| `h` | Toggle session history |
| `t` | Toggle templates panel |
| `Shift+A` | Approve all pending tool approvals |
| `Shift+D` | Deny all pending tool approvals |
| `Ctrl+Click` / `Cmd+Click` | Toggle card in selection |
| `Shift+Drag` | Marquee (box) select on empty canvas |
| `Delete` / `Backspace` | Delete all selected cards |
| `Alt+Scroll` | Zoom in/out |

With two or more cards selected, dragging any one of them moves the whole selection together, and a **Group (N)** button appears in the toolbar to wrap them into a named group. When any session has a pending tool approval, **Approve all / Deny all** toolbar buttons also appear.

## MCP Server Setup

1. Click the **gear icon** to open Settings
2. Go to MCP Servers tab
3. Click "+ Add Server" and pick a transport.

### stdio (local subprocess)

   - **Name:** Display name
   - **Transport:** `stdio`
   - **Command:** e.g., `node`, `python`, `npx`
   - **Args:** comma-separated, e.g., `-y, @modelcontextprotocol/server-filesystem, /tmp`
   - **Env:** Optional `KEY=VALUE` lines

### http (remote, with OAuth 2.1)

For remote MCP servers (e.g. hosted RAG services). Supports OAuth 2.1 with PKCE, both dynamic client registration and pre-registered clients.

   - **Name:** Display name
   - **Transport:** `http`
   - **URL:** e.g. `https://dev.affectli.ai/rag/mcp`
   - **OAuth callback port:** Port for the local redirect listener. Defaults to `8765`. Must match whatever redirect URI the authorization server accepts.
   - **OAuth client_id:** Optional. Set this for servers with a pre-registered client (e.g. Keycloak). Leave blank to use RFC 7591 dynamic registration.
   - **OAuth scopes:** Space-separated. For Keycloak, include `offline_access` so refresh tokens are issued (otherwise you re-auth when the access token expires).
   - **Static headers:** Optional `Header: value` lines for servers that use static bearer tokens instead of OAuth.

**Example — adding affectli-rag:**

| Field | Value |
|---|---|
| Name | `affectli-rag` |
| Transport | `http` |
| URL | `https://dev.affectli.ai/rag/mcp` |
| OAuth client_id | `mi-c3.affectli.com` |
| OAuth scopes | `openid offline_access profile email` |

4. Click **Test Connection**. For HTTP servers, the first click opens your browser to the authorization server's login page. After you authenticate, tokens are stored on disk and refreshed transparently. Subsequent connections use the cached tokens.
5. Set per-tool permissions (always_allow / ask / deny) once discovery succeeds.
6. Use **Edit** to change any field (including OAuth settings) and re-run Test Connection to re-discover tools. Use **Delete** to remove the server (confirms first).

The Test Connection button shows a `Testing…` state during OAuth — this can take 30s+ while you interact with the browser. Errors (invalid scope, unreachable URL, user cancelled) surface inline under the server entry.

## Agent Modes

Three built-in modes available when creating agents:

| Mode | Description |
|------|-------------|
| **Agent** | Full capabilities, all tools enabled |
| **Ask** | Read-only, answers questions without modifying files |
| **Plan** | Analyzes tasks and creates plans, no tool execution |

## Prompt Templates

Built-in templates accessible via slash commands in the chat input:

| Template | Slug | Description |
|----------|------|-------------|
| Code Reviewer | `/code-review` | Review code for bugs, security, and style |
| Data Extractor | `/extract-data` | Extract structured data from sources |
| Summarizer | `/summarize` | Summarize text/files in different styles |
| File Processor | `/process-files` | Process files with custom instructions |

Create custom templates via the Templates panel (press `t`).
