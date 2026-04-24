from typing import Literal, Optional
from uuid import uuid4
from pydantic import BaseModel, Field

class OAuthTokens(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "Bearer"
    expires_at: Optional[float] = None  # unix timestamp
    scope: Optional[str] = None

class OAuthClient(BaseModel):
    """Dynamically-registered OAuth client for a single MCP server."""
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: Optional[str] = None
    client_id: str
    client_secret: Optional[str] = None
    scopes_supported: list[str] = Field(default_factory=list)
    resource: Optional[str] = None  # RFC 8707 resource indicator

class MCPServerConfig(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str
    transport: Literal["stdio", "http"] = "stdio"
    command: Optional[str] = None     # for stdio: e.g. "npx", "python"
    args: list[str] = Field(default_factory=list)  # for stdio: e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    url: Optional[str] = None         # for http/sse
    headers: dict[str, str] = Field(default_factory=dict)  # static headers (e.g. static bearer token)
    callback_port: Optional[int] = None  # OAuth redirect URI port (http://localhost:PORT/callback)
    oauth_client_id: Optional[str] = None  # pre-registered OAuth client_id (skips dynamic registration)
    oauth_scopes: list[str] = Field(default_factory=list)  # override scopes; e.g. ["openid", "offline_access"]
    oauth_client: Optional[OAuthClient] = None   # discovered + registered
    oauth_tokens: Optional[OAuthTokens] = None   # active tokens
    env: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True

class ToolSchema(BaseModel):
    name: str                    # raw tool name from MCP server
    qualified_name: str          # "server_name__tool_name" namespaced
    description: str = ""
    input_schema: dict = Field(default_factory=dict)  # JSON Schema
    server_id: str = ""
    server_name: str = ""
