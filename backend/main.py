import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.agents.agent_manager import agent_manager
from backend.agents.ws_manager import ws_manager
from backend.providers.registry import get_provider, get_registry, get_tool_executor, init_providers, list_providers
from backend.sessions.store import save_layout, load_layout, save_session  # noqa: F401 - kept for backward compat
from backend.agents.models import CardPosition
from backend.mcp.models import MCPServerConfig
from backend.mcp import permissions as mcp_permissions

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_providers()
    agent_manager.restore_sessions()
    from backend.templates.store import seed_builtin_templates
    seed_builtin_templates()
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
        mode_id=body.get("mode_id"),
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


@app.patch("/api/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    body = await request.json()
    session = agent_manager.get_session(session_id)
    if not session:
        return JSONResponse({"error": "Not found"}, status_code=404)
    if "name" in body:
        session.name = body["name"]
    save_session(session)
    await ws_manager.broadcast_dashboard(
        "agent:status",
        {"session_id": session.id, "status": session.status, "session": session.model_dump()},
    )
    return session.model_dump()


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    await agent_manager.delete_session(session_id)
    return {"ok": True}


@app.post("/api/sessions/{session_id}/stop")
async def stop_session(session_id: str):
    await agent_manager.stop_session(session_id)
    return {"ok": True}


# --- Branching ---


@app.post("/api/sessions/{session_id}/branch")
async def branch_session(session_id: str, request: Request):
    body = await request.json()
    branch_id = await agent_manager.branch_message(
        session_id, body["fork_after_message_id"], body["content"],
    )
    return {"branch_id": branch_id}


@app.post("/api/sessions/{session_id}/switch-branch")
async def switch_branch(session_id: str, request: Request):
    body = await request.json()
    await agent_manager.switch_branch(session_id, body["branch_id"])
    return {"ok": True}


@app.get("/api/sessions/{session_id}/branches")
async def list_branches(session_id: str):
    session = agent_manager.get_session(session_id)
    if not session:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return {"branches": {k: v.model_dump() for k, v in session.branches.items()}, "active_branch_id": session.active_branch_id}


# --- View Cards ---


@app.post("/api/view-cards")
async def create_view_card(request: Request):
    from backend.agents.models import ViewCard
    from backend.sessions.store import save_view_card
    body = await request.json()
    card = ViewCard(
        name=body.get("name", "Output"),
        content=body.get("content", ""),
        dashboard_id=body.get("dashboard_id"),
    )
    save_view_card(card)
    return card.model_dump()


@app.get("/api/view-cards")
async def list_view_cards(dashboard_id: str = ""):
    from backend.sessions.store import load_all_view_cards
    cards = load_all_view_cards()
    if dashboard_id:
        cards = [c for c in cards if c.dashboard_id == dashboard_id]
    return {"view_cards": [c.model_dump() for c in cards]}


@app.get("/api/view-cards/{card_id}")
async def get_view_card(card_id: str):
    from backend.sessions.store import load_view_card
    card = load_view_card(card_id)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return card.model_dump()


@app.put("/api/view-cards/{card_id}")
async def update_view_card(card_id: str, request: Request):
    from backend.sessions.store import load_view_card, save_view_card
    card = load_view_card(card_id)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    body = await request.json()
    if "name" in body:
        card.name = body["name"]
    if "content" in body:
        card.content = body["content"]
    save_view_card(card)
    await ws_manager.broadcast_dashboard(
        "view_card:update",
        {"card_id": card_id, "card": card.model_dump()},
    )
    return card.model_dump()


@app.delete("/api/view-cards/{card_id}")
async def delete_view_card(card_id: str):
    from backend.sessions.store import delete_view_card_file
    delete_view_card_file(card_id)
    return {"ok": True}


# --- Git Worktree ---


@app.get("/api/sessions/{session_id}/diff")
async def session_diff(session_id: str):
    session = agent_manager.get_session(session_id)
    if not session or not session.worktree_path:
        return JSONResponse({"error": "No worktree"}, status_code=404)
    from backend.git.worktree_manager import WorktreeManager
    wt = WorktreeManager()
    diff = await wt.get_diff(session.worktree_path)
    return {"diff": diff}


@app.get("/api/sessions/{session_id}/git-status")
async def session_git_status(session_id: str):
    session = agent_manager.get_session(session_id)
    if not session or not session.worktree_path:
        return JSONResponse({"error": "No worktree"}, status_code=404)
    from backend.git.worktree_manager import WorktreeManager
    wt = WorktreeManager()
    status = await wt.get_status(session.worktree_path)
    return {"status": status}


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
    cards, connections, groups = load_dashboard_layout(dashboard_id)
    return {
        "cards": {sid: c.model_dump() for sid, c in cards.items()},
        "connections": [c.model_dump() for c in connections],
        "groups": [g.model_dump() for g in groups],
    }


@app.put("/api/dashboards/{dashboard_id}/layout")
async def save_dashboard_layout_endpoint(dashboard_id: str, request: Request):
    from backend.sessions.store import save_dashboard_layout
    from backend.agents.models import CardGroup, Connection
    body = await request.json()
    cards = {sid: CardPosition.model_validate(c) for sid, c in body.get("cards", {}).items()}
    connections = [Connection.model_validate(c) for c in body.get("connections", [])]
    groups = [CardGroup.model_validate(g) for g in body.get("groups", [])]
    save_dashboard_layout(dashboard_id, cards, connections, groups)
    return {"ok": True}


# --- Templates ---


@app.get("/api/templates")
async def list_templates():
    from backend.templates.store import load_all_templates
    return {"templates": [t.model_dump() for t in load_all_templates()]}


@app.post("/api/templates")
async def create_template(request: Request):
    from backend.templates.models import PromptTemplate
    from backend.templates.store import save_template
    body = await request.json()
    template = PromptTemplate(**body)
    save_template(template)
    return template.model_dump()


@app.get("/api/templates/by-slug/{slug}")
async def get_template_by_slug(slug: str):
    from backend.templates.store import load_template_by_slug
    t = load_template_by_slug(slug)
    if not t:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return t.model_dump()


@app.get("/api/templates/{template_id}")
async def get_template(template_id: str):
    from backend.templates.store import load_template
    t = load_template(template_id)
    if not t:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return t.model_dump()


@app.put("/api/templates/{template_id}")
async def update_template(template_id: str, request: Request):
    from backend.templates.models import PromptTemplate
    from backend.templates.store import load_template, save_template
    existing = load_template(template_id)
    if not existing:
        return JSONResponse({"error": "Not found"}, status_code=404)
    body = await request.json()
    updated = existing.model_copy(update=body)
    updated.id = template_id
    save_template(updated)
    return updated.model_dump()


@app.delete("/api/templates/{template_id}")
async def delete_template_endpoint(template_id: str):
    from backend.templates.store import delete_template
    delete_template(template_id)
    return {"ok": True}


# --- Modes ---


@app.get("/api/modes")
async def list_modes():
    from backend.modes.store import get_all_modes
    return {"modes": [m.model_dump() for m in get_all_modes()]}


@app.post("/api/modes")
async def create_mode(request: Request):
    from backend.modes.models import AgentMode
    from backend.modes.store import save_mode
    body = await request.json()
    mode = AgentMode(**body)
    save_mode(mode)
    return mode.model_dump()


@app.get("/api/modes/{mode_id}")
async def get_mode(mode_id: str):
    from backend.modes.store import get_mode as _get_mode
    m = _get_mode(mode_id)
    if not m:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return m.model_dump()


@app.put("/api/modes/{mode_id}")
async def update_mode(mode_id: str, request: Request):
    from backend.modes.models import AgentMode
    from backend.modes.store import get_mode as _get_mode, save_mode
    existing = _get_mode(mode_id)
    if not existing:
        return JSONResponse({"error": "Not found"}, status_code=404)
    if existing.is_builtin:
        return JSONResponse({"error": "Cannot modify built-in mode"}, status_code=400)
    body = await request.json()
    updated = existing.model_copy(update=body)
    updated.id = mode_id
    save_mode(updated)
    return updated.model_dump()


@app.delete("/api/modes/{mode_id}")
async def delete_mode_endpoint(mode_id: str):
    from backend.modes.store import delete_mode
    delete_mode(mode_id)
    return {"ok": True}


# --- Command Policies ---


@app.get("/api/command-policies")
async def list_command_policies():
    from backend.agents.command_policy import load_policies
    return {"policies": [p.model_dump() for p in load_policies()]}


@app.post("/api/command-policies")
async def create_command_policy(request: Request):
    from backend.agents.command_policy import CommandPolicy, save_policy
    body = await request.json()
    policy = CommandPolicy(**body)
    save_policy(policy)
    return policy.model_dump()


@app.put("/api/command-policies/{policy_id}")
async def update_command_policy(policy_id: str, request: Request):
    from backend.agents.command_policy import get_policy, save_policy
    existing = get_policy(policy_id)
    if not existing:
        return JSONResponse({"error": "Not found"}, status_code=404)
    body = await request.json()
    updated = existing.model_copy(update=body)
    updated.id = policy_id
    save_policy(updated)
    return updated.model_dump()


@app.delete("/api/command-policies/{policy_id}")
async def delete_command_policy_endpoint(policy_id: str):
    from backend.agents.command_policy import delete_policy
    delete_policy(policy_id)
    return {"ok": True}


@app.get("/api/sessions/{session_id}/command-audit")
async def get_command_audit(session_id: str):
    from backend.agents.command_policy import get_audit_log
    return {"entries": [e.model_dump() for e in get_audit_log(session_id)]}


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
