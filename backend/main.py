import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.agents.agent_manager import agent_manager
from backend.agents.ws_manager import ws_manager
from backend.providers.registry import get_provider, get_registry, get_tool_executor, init_providers, list_providers
from backend.sessions.store import save_layout, load_layout  # noqa: F401 - kept for backward compat
from backend.agents.models import CardPosition
from backend.mcp.models import MCPServerConfig
from backend.mcp import permissions as mcp_permissions

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_providers()
    agent_manager.restore_sessions()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Health ---


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# --- Providers ---


@app.get("/api/providers")
async def get_providers():
    return {"providers": list_providers()}


@app.get("/api/providers/{provider_id}/models")
async def get_models(provider_id: str):
    provider = get_provider(provider_id)
    models = await provider.list_models()
    return {"models": models}


@app.get("/api/providers/{provider_id}/health")
async def provider_health(provider_id: str):
    provider = get_provider(provider_id)
    healthy = await provider.is_healthy()
    return {"healthy": healthy}


# --- Sessions ---


@app.post("/api/sessions")
async def create_session(request: Request):
    body = await request.json()
    session = await agent_manager.create_session(
        provider_id=body["provider_id"],
        model=body["model"],
        name=body.get("name", ""),
        system_prompt=body.get("system_prompt"),
        dashboard_id=body.get("dashboard_id"),
        cwd=body.get("cwd"),
    )
    return session.model_dump()


@app.get("/api/sessions")
async def list_sessions(dashboard_id: str = ""):
    sessions = agent_manager.list_sessions(dashboard_id=dashboard_id or None)
    return {"sessions": [s.model_dump() for s in sessions]}


@app.get("/api/sessions/history")
async def session_history(search: str = ""):
    sessions = agent_manager.list_closed_sessions(search=search)
    return {"sessions": [s.model_dump() for s in sessions]}


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    session = agent_manager.get_session(session_id)
    if not session:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return session.model_dump()


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    await agent_manager.delete_session(session_id)
    return {"ok": True}


@app.post("/api/sessions/{session_id}/stop")
async def stop_session(session_id: str):
    await agent_manager.stop_session(session_id)
    return {"ok": True}


# --- Invoke Agent ---


@app.post("/api/agents/invoke")
async def invoke_agent(request: Request):
    body = await request.json()
    result = await agent_manager.invoke_agent(
        provider_id=body["provider_id"],
        model=body["model"],
        message=body["message"],
        parent_session_id=body.get("parent_session_id"),
        system_prompt=body.get("system_prompt"),
    )
    return result


# --- MCP Servers ---


@app.get("/api/mcp-servers")
async def list_mcp_servers():
    registry = get_registry()
    return {"servers": [s.model_dump() for s in registry.list_servers()]}


@app.post("/api/mcp-servers")
async def create_mcp_server(request: Request):
    body = await request.json()
    config = MCPServerConfig(**body)
    registry = get_registry()
    registry.create_server(config)
    return config.model_dump()


@app.get("/api/mcp-servers/{server_id}")
async def get_mcp_server(server_id: str):
    registry = get_registry()
    server = registry.get_server(server_id)
    if not server:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return server.model_dump()


@app.put("/api/mcp-servers/{server_id}")
async def update_mcp_server(server_id: str, request: Request):
    body = await request.json()
    registry = get_registry()
    server = registry.update_server(server_id, body)
    if not server:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return server.model_dump()


@app.delete("/api/mcp-servers/{server_id}")
async def delete_mcp_server(server_id: str):
    registry = get_registry()
    registry.delete_server(server_id)
    return {"ok": True}


@app.get("/api/mcp-servers/{server_id}/tools")
async def discover_mcp_tools(server_id: str):
    registry = get_registry()
    server = registry.get_server(server_id)
    if not server:
        return JSONResponse({"error": "Not found"}, status_code=404)
    executor = get_tool_executor()
    await executor.discover_and_cache(server_id)
    tools = registry.get_cached_tools(server_id) or []
    return {"tools": [t.model_dump() for t in tools]}


# --- Permissions ---


@app.get("/api/permissions")
async def get_permissions():
    return {"permissions": mcp_permissions.get_permissions()}


@app.put("/api/permissions")
async def set_permissions(request: Request):
    body = await request.json()
    mcp_permissions.set_permissions_bulk(body.get("permissions", {}))
    return {"ok": True}


# --- Session Close / Reopen ---


@app.post("/api/sessions/{session_id}/close")
async def close_session(session_id: str):
    await agent_manager.close_session(session_id)
    return {"ok": True}


@app.post("/api/sessions/{session_id}/reopen")
async def reopen_session(session_id: str, request: Request):
    body = await request.json()
    session = await agent_manager.reopen_session(session_id, dashboard_id=body.get("dashboard_id"))
    if not session:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return session.model_dump()


# --- Dashboards ---


@app.get("/api/dashboards")
async def get_dashboards():
    from backend.sessions.store import list_dashboards
    return {"dashboards": list_dashboards()}


@app.post("/api/dashboards")
async def create_new_dashboard(request: Request):
    from backend.sessions.store import create_dashboard
    body = await request.json()
    dashboard = create_dashboard(body.get("name", "New Canvas"))
    return dashboard


@app.get("/api/dashboards/{dashboard_id}")
async def get_dashboard_detail(dashboard_id: str):
    from backend.sessions.store import get_dashboard
    dashboard = get_dashboard(dashboard_id)
    if not dashboard:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return dashboard


@app.put("/api/dashboards/{dashboard_id}")
async def update_dashboard_detail(dashboard_id: str, request: Request):
    from backend.sessions.store import update_dashboard
    body = await request.json()
    dashboard = update_dashboard(dashboard_id, body)
    if not dashboard:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return dashboard


@app.delete("/api/dashboards/{dashboard_id}")
async def delete_dashboard_endpoint(dashboard_id: str):
    from backend.sessions.store import delete_dashboard
    delete_dashboard(dashboard_id)
    return {"ok": True}


@app.get("/api/dashboards/{dashboard_id}/layout")
async def get_dashboard_layout(dashboard_id: str):
    from backend.sessions.store import load_dashboard_layout
    cards = load_dashboard_layout(dashboard_id)
    return {"cards": {sid: c.model_dump() for sid, c in cards.items()}}


@app.put("/api/dashboards/{dashboard_id}/layout")
async def save_dashboard_layout_endpoint(dashboard_id: str, request: Request):
    from backend.sessions.store import save_dashboard_layout
    body = await request.json()
    cards = {sid: CardPosition.model_validate(c) for sid, c in body.get("cards", {}).items()}
    save_dashboard_layout(dashboard_id, cards)
    return {"ok": True}


# --- WebSocket ---


@app.websocket("/ws/dashboard")
async def ws_dashboard(websocket: WebSocket):
    await ws_manager.connect_dashboard(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            event = msg.get("event")
            payload = msg.get("data", {})

            if event == "agent:send_message":
                await agent_manager.send_message(
                    payload["session_id"],
                    payload["content"],
                )
            elif event == "agent:stop":
                await agent_manager.stop_session(payload["session_id"])
            elif event == "agent:approval_response":
                executor = get_tool_executor()
                executor.resolve_approval(
                    payload["approval_id"],
                    payload.get("approved", False),
                )
    except WebSocketDisconnect:
        ws_manager.disconnect_dashboard(websocket)


@app.websocket("/ws/agents/{session_id}")
async def ws_session(websocket: WebSocket, session_id: str):
    await ws_manager.connect_session(session_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            event = msg.get("event")
            payload = msg.get("data", {})

            if event == "agent:send_message":
                await agent_manager.send_message(session_id, payload["content"])
            elif event == "agent:stop":
                await agent_manager.stop_session(session_id)
    except WebSocketDisconnect:
        ws_manager.disconnect_session(session_id, websocket)
