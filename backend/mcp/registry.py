import json
import logging
import re
from pathlib import Path
from backend.mcp.models import MCPServerConfig, ToolSchema

logger = logging.getLogger(__name__)

def _mcp_dir() -> Path:
    """Directory for MCP server config files."""
    import os
    xdg = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    d = Path(xdg) / "agentcanvas" / "mcp_servers"
    d.mkdir(parents=True, exist_ok=True)
    return d

def _sanitize_name(name: str) -> str:
    """Convert server name to a safe identifier for tool namespacing."""
    return re.sub(r'[^a-zA-Z0-9]', '_', name).strip('_').lower()

class MCPRegistry:
    def __init__(self):
        self._tool_cache: dict[str, list[ToolSchema]] = {}  # server_id -> tools

    def list_servers(self) -> list[MCPServerConfig]:
        servers = []
        for path in _mcp_dir().glob("*.json"):
            try:
                servers.append(MCPServerConfig.model_validate_json(path.read_text()))
            except Exception:
                logger.warning("Skipping corrupt MCP config: %s", path.name)
        return servers

    def get_server(self, server_id: str) -> MCPServerConfig | None:
        path = _mcp_dir() / f"{server_id}.json"
        if not path.exists():
            return None
        try:
            return MCPServerConfig.model_validate_json(path.read_text())
        except Exception:
            return None

    def create_server(self, config: MCPServerConfig) -> MCPServerConfig:
        path = _mcp_dir() / f"{config.id}.json"
        path.write_text(json.dumps(config.model_dump(), indent=2))
        return config

    def update_server(self, server_id: str, updates: dict) -> MCPServerConfig | None:
        existing = self.get_server(server_id)
        if not existing:
            return None
        data = existing.model_dump()
        data.update(updates)
        data["id"] = server_id  # prevent ID change
        config = MCPServerConfig.model_validate(data)
        path = _mcp_dir() / f"{server_id}.json"
        path.write_text(json.dumps(config.model_dump(), indent=2))
        self._tool_cache.pop(server_id, None)  # invalidate cache
        return config

    def delete_server(self, server_id: str) -> None:
        path = _mcp_dir() / f"{server_id}.json"
        path.unlink(missing_ok=True)
        self._tool_cache.pop(server_id, None)

    def get_enabled_servers(self) -> list[MCPServerConfig]:
        return [s for s in self.list_servers() if s.enabled]

    def get_cached_tools(self, server_id: str) -> list[ToolSchema] | None:
        return self._tool_cache.get(server_id)

    def set_cached_tools(self, server_id: str, tools: list[ToolSchema]) -> None:
        self._tool_cache[server_id] = tools

    def get_all_tools(self) -> list[ToolSchema]:
        """Return all cached tools from all enabled servers."""
        all_tools = []
        for server in self.get_enabled_servers():
            cached = self._tool_cache.get(server.id)
            if cached:
                all_tools.extend(cached)
        return all_tools

    def invalidate_cache(self, server_id: str) -> None:
        self._tool_cache.pop(server_id, None)
