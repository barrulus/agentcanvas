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

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1-9` | Focus agent card by position |
| `n` | Toggle new agent dialog |
| `s` | Toggle settings |
| `h` | Toggle session history |
| `t` | Toggle templates panel |
| `Shift+A` | Approve all pending tool approvals |
| `Shift+D` | Deny all pending tool approvals |
| `Ctrl+Click` | Multi-select cards (for grouping) |
| `Alt+Scroll` | Zoom in/out |

## MCP Server Setup

1. Click the **gear icon** to open Settings
2. Go to MCP Servers tab
3. Click "Add Server" and configure:
   - **Name:** Display name
   - **Command:** e.g., `node`, `python`
   - **Args:** e.g., `["path/to/server.js"]`
   - **Env:** Optional environment variables
4. Click "Test Connection" to verify
5. Set per-tool permissions (always_allow / ask / deny)

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
