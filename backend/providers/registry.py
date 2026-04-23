from backend.mcp.registry import MCPRegistry
from backend.mcp.tool_executor import ToolExecutor
from backend.providers.base import AgentProvider
from backend.providers.claude_code import ClaudeCodeProvider
from backend.providers.ollama import OllamaProvider

_providers: dict[str, AgentProvider] = {}
_registry: MCPRegistry | None = None
_tool_executor: ToolExecutor | None = None


def _load_settings() -> dict:
    try:
        from backend.sessions.store import load_app_settings
        return load_app_settings()
    except Exception:
        return {}


def init_providers() -> None:
    global _registry, _tool_executor
    _registry = MCPRegistry()
    _tool_executor = ToolExecutor(_registry)
    settings = _load_settings()
    ollama_url = (settings.get("provider_config") or {}).get("ollama_base_url") or "http://localhost:11434"
    # Apply API keys as env vars so provider SDKs pick them up
    import os
    for name, env in (("anthropic", "ANTHROPIC_API_KEY"), ("openai", "OPENAI_API_KEY")):
        val = (settings.get("api_keys") or {}).get(name)
        if val:
            os.environ[env] = val
    _providers["claude-code"] = ClaudeCodeProvider(registry=_registry)
    _providers["ollama"] = OllamaProvider(tool_executor=_tool_executor, base_url=ollama_url)


def apply_settings_update() -> None:
    """Re-initialise providers so setting changes (API keys, Ollama URL) take effect."""
    init_providers()


def get_provider(provider_id: str) -> AgentProvider:
    if provider_id not in _providers:
        raise KeyError(f"Unknown provider: {provider_id}")
    return _providers[provider_id]


def get_registry() -> MCPRegistry:
    assert _registry is not None
    return _registry


def get_tool_executor() -> ToolExecutor:
    assert _tool_executor is not None
    return _tool_executor


def list_providers() -> list[dict]:
    return [
        {
            "id": p.provider_id,
            "name": p.display_name,
            "manages_own_tools": p.manages_own_tools,
        }
        for p in _providers.values()
    ]
