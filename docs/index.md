# AgentCanvas Documentation

AgentCanvas is a provider-agnostic AI agent orchestrator with a spatial canvas interface. Run multiple AI agents side-by-side, connect them with output routing, and build multi-agent workflows.

## Documentation

- **[Getting Started](getting-started.md)** -- Installation, first agent, keyboard shortcuts
- **[Workflow Orchestration](workflows.md)** -- Input cards, named routing, decision trees, groups
- **[Architecture](architecture.md)** -- System design, data flow, providers, storage
- **[API Reference](api-reference.md)** -- REST endpoints, WebSocket events
- **[Data Models](data-models.md)** -- Pydantic models and field reference

## Quick Links

| Topic | Key Info |
|-------|----------|
| Run the app | `nix develop && ./run.sh` or see [Getting Started](getting-started.md) |
| Backend port | `AGENTCANVAS_PORT` env var (default: 8325) |
| Frontend port | 5173 (Vite dev server) |
| Data storage | `~/.local/share/agentcanvas/` |
| Providers | Claude Code (CLI subprocess), Ollama (HTTP API, base URL configurable) |
| API keys | Anthropic / OpenAI, set in Settings → Providers (stored in `settings.json`) |
| Card types | Agent, Input (chat/webhook/file), View, Gate (resolve/synthesize) |
| Multi-select | Shift+drag marquee, Ctrl/Cmd+click toggle, Delete removes all selected |
