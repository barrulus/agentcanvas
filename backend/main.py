import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.agents.agent_manager import agent_manager
from backend.agents.input_manager import input_manager
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
    input_manager.restore_input_cards()
    from backend.agents.gate_manager import gate_manager
    gate_manager.restore_gate_cards()
    from backend.agents.merge_manager import merge_manager
    merge_manager.restore_merge_cards()
    from backend.agents.run_manager import run_manager
    run_manager.restore_runs()
    run_manager.start_sweeper()
    from backend.agents.dialogue_manager import dialogue_manager
    dialogue_manager.restore_dialogue_cards()
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
        tools_enabled=bool(body.get("tools_enabled", True)),
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


@app.get("/api/sessions/{session_id}/last-run")
async def get_session_last_run(session_id: str):
    """Aggregate the most recent run on this session into a flat summary.

    A run begins at the most recent user/system trigger message and includes
    every assistant/tool/system message after it. If the session has no runs
    yet, returns status=idle with empty fields.
    """
    session = agent_manager.get_session(session_id)
    if not session:
        return JSONResponse({"error": "Not found"}, status_code=404)

    msgs = session.messages
    # Find the start of the last run: the last user-role message
    start_idx = next(
        (i for i in range(len(msgs) - 1, -1, -1) if msgs[i].role == "user"),
        None,
    )
    if start_idx is None:
        return {
            "session_id": session.id,
            "status": session.status,
            "started_at": None,
            "ended_at": session.closed_at,
            "duration_ms": None,
            "prompt_in": None,
            "response_out": "",
            "error_text": None,
            "tokens": session.tokens,
            "cost_usd": session.cost_usd,
            "tool_calls": [],
        }

    run_msgs = msgs[start_idx:]
    prompt_msg = run_msgs[0]
    started_at = prompt_msg.timestamp

    # Concatenate assistant text
    response_parts = [
        m.content if isinstance(m.content, str) else str(m.content)
        for m in run_msgs
        if m.role == "assistant"
    ]
    response_out = "\n".join(p for p in response_parts if p)

    # Surface the most recent system-role error message (agent_manager.py:548)
    error_text = None
    if session.status == "error":
        for m in reversed(run_msgs):
            if m.role == "system" and isinstance(m.content, str) and m.content.startswith("Error:"):
                error_text = m.content
                break

    # Pair tool_call → tool_result by tool_call_id
    tool_calls: list[dict] = []
    pending: dict[str, dict] = {}
    for m in run_msgs:
        if m.role == "tool_call":
            entry = {
                "tool_name": m.tool_name,
                "tool_call_id": m.tool_call_id,
                "args": m.content,
                "result": None,
                "started_at": m.timestamp,
                "ended_at": None,
            }
            tool_calls.append(entry)
            if m.tool_call_id:
                pending[m.tool_call_id] = entry
        elif m.role == "tool_result":
            entry = pending.pop(m.tool_call_id or "", None)
            if entry is not None:
                entry["result"] = m.content
                entry["ended_at"] = m.timestamp
            else:
                tool_calls.append({
                    "tool_name": m.tool_name,
                    "tool_call_id": m.tool_call_id,
                    "args": None,
                    "result": m.content,
                    "started_at": None,
                    "ended_at": m.timestamp,
                })

    # End time: when the last message in the run arrived (or now if still running)
    ended_at = run_msgs[-1].timestamp if session.status != "running" else None
    duration_ms = int((ended_at - started_at) * 1000) if ended_at else None

    return {
        "session_id": session.id,
        "status": session.status,
        "started_at": started_at,
        "ended_at": ended_at,
        "duration_ms": duration_ms,
        "prompt_in": prompt_msg.content if isinstance(prompt_msg.content, str) else str(prompt_msg.content),
        "response_out": response_out,
        "error_text": error_text,
        "tokens": session.tokens,
        "cost_usd": session.cost_usd,
        "tool_calls": tool_calls,
    }


@app.patch("/api/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    body = await request.json()
    session = agent_manager.get_session(session_id)
    if not session:
        return JSONResponse({"error": "Not found"}, status_code=404)
    if session.status == "running":
        return JSONResponse({"error": "Cannot edit a running session"}, status_code=409)
    if "name" in body:
        session.name = body["name"]
    if "system_prompt" in body:
        session.system_prompt = body["system_prompt"]
        # Update provider's session state too
        provider = get_provider(session.provider_id)
        if hasattr(provider, '_sessions') and session.id in provider._sessions:
            state = provider._sessions[session.id]
            if hasattr(state, "system_prompt"):
                state.system_prompt = body["system_prompt"]
            elif isinstance(state, dict):
                state["system_prompt"] = body["system_prompt"]
    if "tools_enabled" in body:
        session.tools_enabled = bool(body["tools_enabled"])
        provider = get_provider(session.provider_id)
        if hasattr(provider, '_sessions') and session.id in provider._sessions:
            state = provider._sessions[session.id]
            if hasattr(state, "tools_enabled"):
                state.tools_enabled = session.tools_enabled
            elif isinstance(state, dict):
                state["tools_enabled"] = session.tools_enabled
    # Provider/model swap: drop old provider's per-session state so the next
    # message re-initialises against the new provider/model.
    if "provider_id" in body or "model" in body:
        new_provider_id = body.get("provider_id", session.provider_id)
        new_model = body.get("model", session.model)
        if new_provider_id != session.provider_id:
            old_provider = get_provider(session.provider_id)
            if hasattr(old_provider, '_sessions') and session.id in old_provider._sessions:
                old_provider._sessions.pop(session.id, None)
            session.provider_id = new_provider_id
        if new_model != session.model:
            session.model = new_model
            new_provider = get_provider(session.provider_id)
            if hasattr(new_provider, '_sessions') and session.id in new_provider._sessions:
                state = new_provider._sessions[session.id]
                if hasattr(state, "model"):
                    state.model = new_model
                elif isinstance(state, dict):
                    state["model"] = new_model
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


# --- Gate Cards ---


@app.post("/api/gate-cards")
async def create_gate_card_endpoint(request: Request):
    from backend.agents.gate_manager import gate_manager
    body = await request.json()
    card = gate_manager.create_gate_card(
        name=body.get("name", "Gate"),
        mode=body.get("mode", "resolve"),
        provider_id=body.get("provider_id", ""),
        model=body.get("model", ""),
        dashboard_id=body.get("dashboard_id"),
    )
    return card.model_dump()


@app.get("/api/gate-cards")
async def list_gate_cards(request: Request):
    from backend.agents.gate_manager import gate_manager
    dashboard_id = request.query_params.get("dashboard_id")
    cards = gate_manager.list_gate_cards(dashboard_id)
    return {"gate_cards": [c.model_dump() for c in cards]}


@app.get("/api/gate-cards/{card_id}")
async def get_gate_card(card_id: str):
    from backend.agents.gate_manager import gate_manager
    card = gate_manager.get_gate_card(card_id)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return card.model_dump()


@app.put("/api/gate-cards/{card_id}")
async def update_gate_card(card_id: str, request: Request):
    from backend.agents.gate_manager import gate_manager
    body = await request.json()
    card = gate_manager.update_gate_card(card_id, body)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return card.model_dump()


@app.delete("/api/gate-cards/{card_id}")
async def delete_gate_card(card_id: str):
    from backend.agents.gate_manager import gate_manager
    gate_manager.delete_gate_card(card_id)
    return {"ok": True}


@app.post("/api/gate-cards/{card_id}/reset")
async def reset_gate_card(card_id: str):
    from backend.agents.gate_manager import gate_manager
    await gate_manager.reset(card_id)
    return {"ok": True}


# --- Merge Cards ---


@app.post("/api/merge-cards")
async def create_merge_card_endpoint(request: Request):
    from backend.agents.merge_manager import merge_manager
    body = await request.json()
    card = merge_manager.create_merge_card(
        name=body.get("name", "Merge"),
        template=body.get("template", ""),
        timeout_seconds=int(body.get("timeout_seconds", 60)),
        dashboard_id=body.get("dashboard_id"),
    )
    return card.model_dump()


@app.get("/api/merge-cards")
async def list_merge_cards(request: Request):
    from backend.agents.merge_manager import merge_manager
    dashboard_id = request.query_params.get("dashboard_id")
    cards = merge_manager.list_merge_cards(dashboard_id)
    return {"merge_cards": [c.model_dump() for c in cards]}


@app.get("/api/merge-cards/{card_id}")
async def get_merge_card(card_id: str):
    from backend.agents.merge_manager import merge_manager
    card = merge_manager.get_merge_card(card_id)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return card.model_dump()


@app.patch("/api/merge-cards/{card_id}")
async def update_merge_card(card_id: str, request: Request):
    from backend.agents.merge_manager import merge_manager
    body = await request.json()
    card = merge_manager.update_merge_card(card_id, body)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return card.model_dump()


@app.delete("/api/merge-cards/{card_id}")
async def delete_merge_card(card_id: str):
    from backend.agents.merge_manager import merge_manager
    merge_manager.delete_merge_card(card_id)
    return {"ok": True}


@app.post("/api/merge-cards/{card_id}/reset")
async def reset_merge_card(card_id: str):
    from backend.agents.merge_manager import merge_manager
    await merge_manager.reset(card_id)
    return {"ok": True}


# --- Workflow Runs ---


@app.get("/api/dashboards/{dashboard_id}/runs")
async def list_dashboard_runs(dashboard_id: str, limit: int = 50, offset: int = 0):
    from backend.agents.run_manager import run_manager
    runs = run_manager.list_runs(dashboard_id, limit=limit, offset=offset)
    return {"runs": [r.model_dump() for r in runs], "limit": limit, "offset": offset}


@app.get("/api/runs/{run_id}")
async def get_run_endpoint(run_id: str):
    from backend.agents.run_manager import run_manager
    run = run_manager.get_run(run_id)
    if not run:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return run.model_dump()


# --- Dialogue Cards ---


@app.post("/api/dialogue-cards")
async def create_dialogue_card_endpoint(request: Request):
    from backend.agents.dialogue_manager import dialogue_manager
    from backend.agents.models import DialogueParticipant
    body = await request.json()
    participants = [
        DialogueParticipant.model_validate(p) for p in (body.get("participants") or [])
    ]
    card = dialogue_manager.create_dialogue_card(
        name=body.get("name", "Dialogue"),
        participants=participants,
        max_turns=int(body.get("max_turns", 20)),
        termination_rule=body.get("termination_rule") or None,
        initial_prompt=body.get("initial_prompt", ""),
        output_mode=body.get("output_mode", "last_message"),
        dashboard_id=body.get("dashboard_id"),
    )
    return card.model_dump()


@app.get("/api/dialogue-cards")
async def list_dialogue_cards(request: Request):
    from backend.agents.dialogue_manager import dialogue_manager
    dashboard_id = request.query_params.get("dashboard_id")
    cards = dialogue_manager.list_dialogue_cards(dashboard_id)
    return {"dialogue_cards": [c.model_dump() for c in cards]}


@app.get("/api/dialogue-cards/{card_id}")
async def get_dialogue_card(card_id: str):
    from backend.agents.dialogue_manager import dialogue_manager
    card = dialogue_manager.get_dialogue_card(card_id)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return card.model_dump()


@app.put("/api/dialogue-cards/{card_id}")
async def update_dialogue_card(card_id: str, request: Request):
    from backend.agents.dialogue_manager import dialogue_manager
    body = await request.json()
    card = dialogue_manager.update_dialogue_card(card_id, body)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return card.model_dump()


@app.delete("/api/dialogue-cards/{card_id}")
async def delete_dialogue_card(card_id: str):
    from backend.agents.dialogue_manager import dialogue_manager
    dialogue_manager.delete_dialogue_card(card_id)
    return {"ok": True}


@app.post("/api/dialogue-cards/{card_id}/start")
async def start_dialogue_card(card_id: str):
    from backend.agents.dialogue_manager import dialogue_manager
    await dialogue_manager.start_manually(card_id)
    return {"ok": True}


@app.post("/api/dialogue-cards/{card_id}/reset")
async def reset_dialogue_card(card_id: str):
    from backend.agents.dialogue_manager import dialogue_manager
    await dialogue_manager.reset(card_id)
    return {"ok": True}


# --- Input Cards ---


@app.post("/api/input-cards")
async def create_input_card(request: Request):
    body = await request.json()
    card = input_manager.create_input_card(
        name=body.get("name", "Input"),
        source_type=body.get("source_type", "chat"),
        config=body.get("config", {}),
        dashboard_id=body.get("dashboard_id"),
    )
    return card.model_dump()


@app.get("/api/input-cards")
async def list_input_cards(dashboard_id: str = ""):
    cards = input_manager.list_input_cards(dashboard_id=dashboard_id or None)
    return {"input_cards": [c.model_dump() for c in cards]}


@app.get("/api/input-cards/{card_id}")
async def get_input_card(card_id: str):
    card = input_manager.get_input_card(card_id)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return card.model_dump()


@app.put("/api/input-cards/{card_id}")
async def update_input_card(card_id: str, request: Request):
    body = await request.json()
    card = input_manager.update_input_card(card_id, body)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return card.model_dump()


@app.delete("/api/input-cards/{card_id}")
async def delete_input_card(card_id: str):
    input_manager.delete_input_card(card_id)
    return {"ok": True}


@app.post("/api/input-cards/{card_id}/send")
async def send_input_card(card_id: str, request: Request):
    """Manual send from the UI chat input."""
    body = await request.json()
    content = body.get("content", "")
    if not content:
        return JSONResponse({"error": "No content"}, status_code=400)
    card = input_manager.get_input_card(card_id)
    if not card or not card.dashboard_id:
        return JSONResponse({"error": "Card not found or has no dashboard"}, status_code=404)
    from backend.agents.run_manager import run_manager
    run = run_manager.start_run(card.dashboard_id, "input", card_id, agent_manager)
    run_manager.record_card_start(run.id, card_id, agent_manager)
    await input_manager.send_to_downstream(card_id, content, run_id=run.id)
    run_manager.record_card_end(card_id, status="completed")
    return {"ok": True, "run_id": run.id}


@app.post("/api/input-cards/{card_id}/webhook")
async def input_card_webhook(card_id: str, request: Request):
    """Receive external webhook data and route to downstream agents."""
    card = input_manager.get_input_card(card_id)
    if not card:
        return JSONResponse({"error": "Not found"}, status_code=404)
    if card.source_type != "webhook":
        return JSONResponse({"error": "Card is not in webhook mode"}, status_code=400)
    body = await request.json()
    content = body.get("content", "") or body.get("text", "") or body.get("data", "")
    if isinstance(content, dict | list):
        import json as _json
        content = _json.dumps(content)
    if not content:
        return JSONResponse({"error": "No content found in payload"}, status_code=400)
    if not card.dashboard_id:
        return JSONResponse({"error": "Card has no dashboard"}, status_code=400)
    from backend.agents.run_manager import run_manager
    run = run_manager.start_run(card.dashboard_id, "webhook", card_id, agent_manager)
    run_manager.record_card_start(run.id, card_id, agent_manager)
    await input_manager.send_to_downstream(card_id, str(content), run_id=run.id)
    run_manager.record_card_end(card_id, status="completed")
    await ws_manager.broadcast_dashboard(
        "input_card:triggered",
        {"card_id": card_id, "source": "webhook"},
    )
    return {"ok": True, "run_id": run.id}


@app.post("/api/dashboards/{dashboard_id}/invoke")
async def dashboard_invoke(dashboard_id: str, request: Request):
    """Synchronously invoke a dashboard via webhook.

    Body: { input_card_id, output_card_id, content, timeout? }

    Sends `content` to the input card, awaits the next content delivered to the
    output (view) card, and returns it. Times out with 504 if no response within
    `timeout` seconds (default 60).
    """
    import asyncio as _asyncio
    import json as _json

    body = await request.json()
    input_card_id = body.get("input_card_id")
    output_card_id = body.get("output_card_id")
    content = body.get("content", "")
    timeout = float(body.get("timeout", 60))

    if not input_card_id or not output_card_id:
        return JSONResponse(
            {"error": "input_card_id and output_card_id are required"},
            status_code=400,
        )
    if isinstance(content, dict | list):
        content = _json.dumps(content)
    if not content:
        return JSONResponse({"error": "content is required"}, status_code=400)

    in_card = input_manager.get_input_card(input_card_id)
    if not in_card or in_card.dashboard_id != dashboard_id:
        return JSONResponse(
            {"error": "input_card_id not found on this dashboard"},
            status_code=404,
        )

    from backend.sessions.store import load_view_card
    out_card = load_view_card(output_card_id)
    if not out_card or out_card.dashboard_id != dashboard_id:
        return JSONResponse(
            {"error": "output_card_id not found on this dashboard"},
            status_code=404,
        )

    from backend.agents.agent_manager import register_invocation, unregister_invocation
    fut = register_invocation(output_card_id)
    try:
        from backend.agents.run_manager import run_manager
        run = run_manager.start_run(dashboard_id, "webhook", input_card_id, agent_manager)
        run_manager.record_card_start(run.id, input_card_id, agent_manager)
        await input_manager.send_to_downstream(input_card_id, str(content), run_id=run.id)
        run_manager.record_card_end(input_card_id, status="completed")
        await ws_manager.broadcast_dashboard(
            "input_card:triggered",
            {"card_id": input_card_id, "source": "invoke"},
        )
        result = await _asyncio.wait_for(fut, timeout=timeout)
        return {"content": result}
    except _asyncio.TimeoutError:
        unregister_invocation(output_card_id, fut)
        return JSONResponse(
            {"error": f"Workflow did not produce output on card {output_card_id} within {timeout}s"},
            status_code=504,
        )
    except _asyncio.CancelledError:
        unregister_invocation(output_card_id, fut)
        raise


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


# --- Internal MCP proxy (used by http_proxy_server.py to forward HTTP MCP tools to
#     Claude Code over stdio). Bound to 127.0.0.1 already; no auth beyond that. ---


@app.get("/api/internal/mcp-proxy/tools")
async def _mcp_proxy_list_tools():
    """Aggregate tools from every enabled HTTP MCP server.

    Triggers tool discovery (and OAuth if needed) for servers whose cache is empty.
    """
    registry = get_registry()
    executor = get_tool_executor()
    http_servers = [s for s in registry.get_enabled_servers() if s.transport == "http"]
    tools_out: list[dict] = []
    for server in http_servers:
        cached = registry.get_cached_tools(server.id)
        if not cached:
            try:
                await executor.discover_and_cache(server.id)
                cached = registry.get_cached_tools(server.id) or []
            except Exception as e:
                logger.warning("mcp-proxy: discovery failed for %s: %s", server.name, e)
                cached = []
        for t in cached:
            tools_out.append({
                "name": t.qualified_name,
                "description": t.description or t.name,
                "inputSchema": t.input_schema or {"type": "object", "properties": {}},
            })
    return {"tools": tools_out}


@app.post("/api/internal/mcp-proxy/call")
async def _mcp_proxy_call_tool(request: Request):
    """Invoke one tool on its owning HTTP MCP server.

    Respects the registry's global deny policy but bypasses ``ask`` approval —
    the caller is Claude Code, which has its own permission model and is invoked
    with ``--dangerously-skip-permissions``.
    """
    body = await request.json()
    qualified_name = body.get("qualified_name", "")
    arguments = body.get("arguments", {}) or {}
    if not qualified_name:
        return JSONResponse({"error": "qualified_name required"}, status_code=400)

    from backend.mcp.permissions import get_policy
    if get_policy(qualified_name) == "deny":
        return JSONResponse({"error": f"Tool '{qualified_name}' denied by policy"}, status_code=403)

    executor = get_tool_executor()
    entry = executor._tool_index.get(qualified_name)
    if not entry:
        # Cold cache — refresh HTTP server tools and try once more
        registry = get_registry()
        for server in registry.get_enabled_servers():
            if server.transport == "http":
                try:
                    await executor.discover_and_cache(server.id)
                except Exception:
                    pass
        entry = executor._tool_index.get(qualified_name)
    if not entry:
        return JSONResponse({"error": f"Unknown tool: {qualified_name}"}, status_code=404)

    server_id, raw_name = entry
    conn = await executor._get_connection(server_id)
    if not conn:
        return JSONResponse({"error": f"Could not connect to MCP server for {qualified_name}"}, status_code=502)
    try:
        out = await conn.call_tool(raw_name, arguments)
        return {"content": out}
    except Exception as e:
        logger.exception("mcp-proxy: call failed for %s", qualified_name)
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/api/mcp-servers/{server_id}/tools")
async def discover_mcp_tools(server_id: str):
    registry = get_registry()
    server = registry.get_server(server_id)
    if not server:
        return JSONResponse({"error": "Not found"}, status_code=404)
    executor = get_tool_executor()
    try:
        # Direct call (bypasses the swallow-all in discover_and_cache) so we can
        # surface errors — e.g. auth failures or unreachable URLs — to the UI.
        from backend.mcp.client import discover_tools
        tools = await discover_tools(server)
        registry.set_cached_tools(server.id, tools)
        for t in tools:
            executor._tool_index[t.qualified_name] = (server.id, t.name)
        return {"tools": [t.model_dump() for t in tools]}
    except Exception as e:
        logger.exception("Tool discovery failed for %s", server.name)
        return JSONResponse(
            {"error": str(e), "server_id": server_id}, status_code=502
        )


# --- Permissions ---


@app.get("/api/permissions")
async def get_permissions():
    return {"permissions": mcp_permissions.get_permissions()}


@app.put("/api/permissions")
async def set_permissions(request: Request):
    body = await request.json()
    mcp_permissions.set_permissions_bulk(body.get("permissions", {}))
    return {"ok": True}


# --- App settings (API keys, provider config) ---


@app.get("/api/settings")
async def get_app_settings():
    from backend.sessions.store import public_app_settings
    return public_app_settings()


@app.put("/api/settings")
async def update_app_settings(request: Request):
    from backend.sessions.store import save_app_settings, public_app_settings
    body = await request.json()
    save_app_settings(body)
    # Apply runtime changes: re-init providers so new Ollama base URL takes effect
    from backend.providers.registry import apply_settings_update
    apply_settings_update()
    return public_app_settings()


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
    from backend.sessions.store import load_dashboard_layout, load_dashboard_constraints
    cards, connections, groups = load_dashboard_layout(dashboard_id)
    return {
        "cards": {sid: c.model_dump() for sid, c in cards.items()},
        "connections": [c.model_dump() for c in connections],
        "groups": [g.model_dump() for g in groups],
        "constraints": load_dashboard_constraints(dashboard_id),
    }


@app.put("/api/dashboards/{dashboard_id}/layout")
async def save_dashboard_layout_endpoint(dashboard_id: str, request: Request):
    from backend.sessions.store import save_dashboard_layout
    from backend.agents.models import CardGroup, Connection
    body = await request.json()
    cards = {sid: CardPosition.model_validate(c) for sid, c in body.get("cards", {}).items()}
    connections = [Connection.model_validate(c) for c in body.get("connections", [])]
    groups = [CardGroup.model_validate(g) for g in body.get("groups", [])]
    constraints = body.get("constraints")
    save_dashboard_layout(dashboard_id, cards, connections, groups, constraints=constraints)
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
                target_session_id = payload["session_id"]
                session = agent_manager.get_session(target_session_id)
                if session and session.dashboard_id:
                    from backend.agents.run_manager import run_manager
                    run = run_manager.start_run(session.dashboard_id, "manual", target_session_id, agent_manager)
                    run_manager.record_card_start(run.id, target_session_id, agent_manager)
                await agent_manager.send_message(
                    target_session_id,
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
                session = agent_manager.get_session(session_id)
                if session and session.dashboard_id:
                    from backend.agents.run_manager import run_manager
                    run = run_manager.start_run(session.dashboard_id, "manual", session_id, agent_manager)
                    run_manager.record_card_start(run.id, session_id, agent_manager)
                await agent_manager.send_message(session_id, payload["content"])
            elif event == "agent:stop":
                await agent_manager.stop_session(session_id)
    except WebSocketDisconnect:
        ws_manager.disconnect_session(session_id, websocket)
