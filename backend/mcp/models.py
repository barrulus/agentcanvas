from typing import Literal, Optional
from uuid import uuid4
from pydantic import BaseModel, Field

class MCPServerConfig(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str
    transport: Literal["stdio", "http"] = "stdio"
    command: Optional[str] = None     # for stdio: e.g. "npx", "python"
    args: list[str] = Field(default_factory=list)  # for stdio: e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    url: Optional[str] = None         # for http/sse
    env: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True

class ToolSchema(BaseModel):
    name: str                    # raw tool name from MCP server
    qualified_name: str          # "server_name__tool_name" namespaced
    description: str = ""
    input_schema: dict = Field(default_factory=dict)  # JSON Schema
    server_id: str = ""
    server_name: str = ""
