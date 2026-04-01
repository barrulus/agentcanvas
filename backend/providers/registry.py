from backend.providers.base import AgentProvider
from backend.providers.claude_code import ClaudeCodeProvider
from backend.providers.ollama import OllamaProvider

_providers: dict[str, AgentProvider] = {}


def init_providers() -> None:
    _providers["claude-code"] = ClaudeCodeProvider()
    _providers["ollama"] = OllamaProvider()


def get_provider(provider_id: str) -> AgentProvider:
    if provider_id not in _providers:
        raise KeyError(f"Unknown provider: {provider_id}")
    return _providers[provider_id]


def list_providers() -> list[dict]:
    return [
        {
            "id": p.provider_id,
            "name": p.display_name,
            "manages_own_tools": p.manages_own_tools,
        }
        for p in _providers.values()
    ]
