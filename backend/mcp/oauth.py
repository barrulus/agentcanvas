"""OAuth 2.1 (with PKCE) client for MCP HTTP servers.

Implements the flow described in MCP spec:
  1. Discover protected-resource metadata via WWW-Authenticate header (or well-known).
  2. Discover authorization-server metadata.
  3. Dynamic client registration (RFC 7591) if the server supports it.
  4. Authorization code grant with PKCE (RFC 7636) + resource indicators (RFC 8707).
  5. Token refresh.

The backend runs locally, so we open the user's browser with ``webbrowser.open`` and
listen for the redirect on ``http://localhost:{callback_port}/callback``.
"""

import asyncio
import base64
import hashlib
import logging
import secrets
import time
import urllib.parse
import webbrowser
from dataclasses import dataclass
from typing import Optional

import httpx

from backend.mcp.models import MCPServerConfig, OAuthClient, OAuthTokens

logger = logging.getLogger(__name__)

DEFAULT_CALLBACK_PORT = 8765


class OAuthError(Exception):
    pass


@dataclass
class ProtectedResourceMetadata:
    resource: str
    authorization_servers: list[str]


def _pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


def _parse_www_authenticate(header: str) -> dict[str, str]:
    """Parse a WWW-Authenticate: Bearer realm=... resource_metadata=... header."""
    out: dict[str, str] = {}
    if not header:
        return out
    # strip scheme (Bearer, DPoP, etc.)
    parts = header.split(" ", 1)
    rest = parts[1] if len(parts) == 2 else header
    for piece in rest.split(","):
        piece = piece.strip()
        if "=" not in piece:
            continue
        k, v = piece.split("=", 1)
        out[k.strip().lower()] = v.strip().strip('"')
    return out


async def fetch_protected_resource_metadata(
    http: httpx.AsyncClient, resource_url: str, metadata_url: Optional[str] = None
) -> ProtectedResourceMetadata:
    """Resolve the protected-resource metadata for an MCP server URL."""
    candidates: list[str] = []
    if metadata_url:
        candidates.append(metadata_url)
    # Per RFC 9728, well-known is served at the resource origin.
    parsed = urllib.parse.urlparse(resource_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    candidates.append(f"{origin}/.well-known/oauth-protected-resource")
    if parsed.path and parsed.path != "/":
        candidates.append(
            f"{origin}/.well-known/oauth-protected-resource{parsed.path}"
        )

    last_err: Optional[str] = None
    for url in candidates:
        try:
            r = await http.get(url, timeout=10.0)
            if r.status_code != 200:
                last_err = f"{url} → {r.status_code}"
                continue
            data = r.json()
            servers = data.get("authorization_servers") or []
            if not servers:
                continue
            return ProtectedResourceMetadata(
                resource=data.get("resource", resource_url),
                authorization_servers=servers,
            )
        except Exception as e:
            last_err = f"{url} → {e}"
            continue
    raise OAuthError(f"Could not resolve protected-resource metadata: {last_err}")


async def fetch_authorization_server_metadata(
    http: httpx.AsyncClient, issuer: str
) -> dict:
    """Fetch .well-known/oauth-authorization-server metadata."""
    base = issuer.rstrip("/")
    candidates = [
        f"{base}/.well-known/oauth-authorization-server",
        f"{base}/.well-known/openid-configuration",
    ]
    last_err: Optional[str] = None
    for url in candidates:
        try:
            r = await http.get(url, timeout=10.0)
            if r.status_code != 200:
                last_err = f"{url} → {r.status_code}"
                continue
            return r.json()
        except Exception as e:
            last_err = f"{url} → {e}"
    raise OAuthError(f"Could not fetch authorization-server metadata: {last_err}")


async def register_client_dynamic(
    http: httpx.AsyncClient,
    registration_endpoint: str,
    redirect_uri: str,
    client_name: str,
) -> dict:
    """Perform RFC 7591 dynamic client registration."""
    body = {
        "client_name": client_name,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",  # public client (PKCE)
        "application_type": "native",
    }
    r = await http.post(registration_endpoint, json=body, timeout=15.0)
    if r.status_code not in (200, 201):
        raise OAuthError(
            f"Dynamic client registration failed: {r.status_code} {r.text[:300]}"
        )
    return r.json()


class _CallbackListener:
    """Tiny asyncio HTTP server that captures the OAuth redirect."""

    def __init__(self, port: int, expected_state: str):
        self.port = port
        self.expected_state = expected_state
        self._code: Optional[str] = None
        self._error: Optional[str] = None
        self._done = asyncio.Event()
        self._server: Optional[asyncio.base_events.Server] = None

    async def start(self) -> None:
        self._server = await asyncio.start_server(
            self._handle_client, host="127.0.0.1", port=self.port
        )

    async def wait(self, timeout: float = 300.0) -> str:
        try:
            await asyncio.wait_for(self._done.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            raise OAuthError("Timed out waiting for OAuth redirect")
        finally:
            if self._server:
                self._server.close()
                try:
                    await self._server.wait_closed()
                except Exception:
                    pass
        if self._error:
            raise OAuthError(f"OAuth error: {self._error}")
        if not self._code:
            raise OAuthError("No authorization code received")
        return self._code

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            request_line = await reader.readline()
            # drain headers
            while True:
                line = await reader.readline()
                if line in (b"\r\n", b"\n", b""):
                    break
            parts = request_line.decode(errors="replace").split(" ")
            if len(parts) < 2:
                self._respond(writer, 400, "Bad Request")
                return
            path = parts[1]
            parsed = urllib.parse.urlparse(path)
            qs = urllib.parse.parse_qs(parsed.query)
            state = (qs.get("state") or [""])[0]
            if state != self.expected_state:
                self._error = "state mismatch"
                self._respond(writer, 400, "State mismatch")
                self._done.set()
                return
            if "error" in qs:
                err_desc = qs.get("error_description") or qs.get("error") or [""]
                self._error = err_desc[0]
                self._respond(writer, 400, f"Authorization failed: {self._error}")
                self._done.set()
                return
            code = (qs.get("code") or [""])[0]
            if not code:
                self._error = "missing code"
                self._respond(writer, 400, "Missing authorization code")
                self._done.set()
                return
            self._code = code
            self._respond(
                writer, 200,
                "<html><body style='font-family:sans-serif;padding:40px;"
                "background:#0a0a0f;color:#e0e0e0'>"
                "<h2>Authentication complete</h2>"
                "<p>You can close this tab and return to AgentCanvas.</p>"
                "</body></html>",
                content_type="text/html; charset=utf-8",
            )
            self._done.set()
        except Exception as e:
            logger.exception("callback handler failed")
            self._error = str(e)
            self._done.set()
        finally:
            try:
                await writer.drain()
            except Exception:
                pass
            writer.close()

    @staticmethod
    def _respond(
        writer: asyncio.StreamWriter,
        status: int,
        body: str,
        content_type: str = "text/plain; charset=utf-8",
    ) -> None:
        reason = {200: "OK", 400: "Bad Request"}.get(status, "OK")
        payload = body.encode()
        writer.write(
            (
                f"HTTP/1.1 {status} {reason}\r\n"
                f"Content-Type: {content_type}\r\n"
                f"Content-Length: {len(payload)}\r\n"
                f"Connection: close\r\n\r\n"
            ).encode()
            + payload
        )


async def perform_oauth_flow(
    config: MCPServerConfig,
    metadata_hint: Optional[str] = None,
) -> tuple[OAuthClient, OAuthTokens]:
    """End-to-end OAuth flow: discovery → dynamic registration → auth code + PKCE → token.

    Returns (client, tokens). The caller is responsible for persisting them back
    onto the ``MCPServerConfig`` via the registry.
    """
    if not config.url:
        raise OAuthError("HTTP MCP server missing URL")
    port = config.callback_port or DEFAULT_CALLBACK_PORT
    redirect_uri = f"http://localhost:{port}/callback"

    async with httpx.AsyncClient() as http:
        prm = await fetch_protected_resource_metadata(
            http, config.url, metadata_url=metadata_hint
        )
        if not prm.authorization_servers:
            raise OAuthError("No authorization_servers in protected-resource metadata")
        issuer = prm.authorization_servers[0]
        asm = await fetch_authorization_server_metadata(http, issuer)

        auth_endpoint = asm.get("authorization_endpoint")
        token_endpoint = asm.get("token_endpoint")
        reg_endpoint = asm.get("registration_endpoint")
        scopes_supported = asm.get("scopes_supported") or []
        if not auth_endpoint or not token_endpoint:
            raise OAuthError("Missing authorization/token endpoint in metadata")

        # Resolution order for the client_id:
        #   1. User-provided pre-registered client (config.oauth_client_id)
        #   2. Previously registered + cached client (config.oauth_client)
        #   3. Dynamic client registration (RFC 7591)
        client_id: str
        client_secret: Optional[str] = None
        existing = config.oauth_client
        if config.oauth_client_id:
            client_id = config.oauth_client_id
        elif existing and existing.token_endpoint == token_endpoint and existing.client_id:
            client_id = existing.client_id
            client_secret = existing.client_secret
        else:
            if not reg_endpoint:
                raise OAuthError(
                    "Server does not advertise registration_endpoint and no client_id "
                    "is configured. Set 'OAuth client_id' on the server."
                )
            reg = await register_client_dynamic(
                http, reg_endpoint, redirect_uri, client_name="AgentCanvas"
            )
            client_id = reg["client_id"]
            client_secret = reg.get("client_secret")

        # PKCE + state
        verifier, challenge = _pkce_pair()
        state = secrets.token_urlsafe(16)

        # Scope resolution: explicit override → advertised scopes → fallback.
        # "offline_access" is required by Keycloak (and matches the user's setup)
        # so we ensure it is present when the server advertises it but we are
        # falling back to advertised scopes.
        if config.oauth_scopes:
            scope_list = config.oauth_scopes
        elif scopes_supported:
            scope_list = list(scopes_supported)
            if "offline_access" in scopes_supported and "offline_access" not in scope_list:
                scope_list.append("offline_access")
        else:
            scope_list = []
        scope_param = " ".join(scope_list) if scope_list else None

        params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        # RFC 8707 resource indicator. prm.resource is only populated when a real
        # protected-resource metadata document was fetched, so forwarding it is safe.
        if prm.resource:
            params["resource"] = prm.resource
        if scope_param:
            params["scope"] = scope_param
        auth_url = auth_endpoint + (
            "&" if "?" in auth_endpoint else "?"
        ) + urllib.parse.urlencode(params)

        listener = _CallbackListener(port=port, expected_state=state)
        await listener.start()
        logger.info("Opening browser for OAuth: %s", auth_url)
        webbrowser.open(auth_url)
        code = await listener.wait(timeout=300.0)

        # Exchange code for token
        token_body = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "code_verifier": verifier,
        }
        if prm.resource:
            token_body["resource"] = prm.resource
        post_kwargs: dict = {"data": token_body, "timeout": 30.0}
        if client_secret:
            post_kwargs["auth"] = (client_id, client_secret)
        tr = await http.post(token_endpoint, **post_kwargs)
        if tr.status_code != 200:
            raise OAuthError(f"Token exchange failed: {tr.status_code} {tr.text[:400]}")
        td = tr.json()

        expires_at = None
        if isinstance(td.get("expires_in"), (int, float)):
            expires_at = time.time() + float(td["expires_in"]) - 30.0  # 30s safety

        tokens = OAuthTokens(
            access_token=td["access_token"],
            refresh_token=td.get("refresh_token"),
            token_type=td.get("token_type", "Bearer"),
            expires_at=expires_at,
            scope=td.get("scope"),
        )
        client = OAuthClient(
            authorization_endpoint=auth_endpoint,
            token_endpoint=token_endpoint,
            registration_endpoint=reg_endpoint,
            client_id=client_id,
            client_secret=client_secret,
            scopes_supported=scopes_supported,
            resource=prm.resource,
        )
        return client, tokens


async def refresh_tokens(
    client: OAuthClient, tokens: OAuthTokens
) -> OAuthTokens:
    """Refresh access token using refresh_token grant."""
    if not tokens.refresh_token:
        raise OAuthError("No refresh_token available")
    body = {
        "grant_type": "refresh_token",
        "refresh_token": tokens.refresh_token,
        "client_id": client.client_id,
    }
    # Only forward resource indicator if it differs from the MCP URL (advertised
    # by a real RFC 9728 resource-metadata document).
    if client.resource:
        body["resource"] = client.resource
    post_kwargs: dict = {"data": body, "timeout": 30.0}
    if client.client_secret:
        post_kwargs["auth"] = (client.client_id, client.client_secret)
    async with httpx.AsyncClient() as http:
        r = await http.post(client.token_endpoint, **post_kwargs)
    if r.status_code != 200:
        raise OAuthError(f"Token refresh failed: {r.status_code} {r.text[:400]}")
    td = r.json()
    expires_at = None
    if isinstance(td.get("expires_in"), (int, float)):
        expires_at = time.time() + float(td["expires_in"]) - 30.0
    return OAuthTokens(
        access_token=td["access_token"],
        refresh_token=td.get("refresh_token") or tokens.refresh_token,
        token_type=td.get("token_type", "Bearer"),
        expires_at=expires_at,
        scope=td.get("scope", tokens.scope),
    )
