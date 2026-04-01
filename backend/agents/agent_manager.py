import asyncio
import logging

from backend.agents.models import AgentSession, Message
from backend.agents.ws_manager import ws_manager
from backend.providers.base import (
    CostUpdate,
    TextDelta,
    ToolCallComplete,
    ToolCallDelta,
    ToolCallStart,
    TurnComplete,
)
from backend.providers.registry import get_provider
from backend.sessions.store import save_session, load_all_sessions, delete_session_file

logger = logging.getLogger(__name__)


class AgentManager:
    def __init__(self) -> None:
        self.sessions: dict[str, AgentSession] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    async def create_session(
        self,
        provider_id: str,
        model: str,
        name: str = "",
        system_prompt: str | None = None,
        dashboard_id: str | None = None,
        cwd: str | None = None,
    ) -> AgentSession:
        session = AgentSession(
            provider_id=provider_id,
            model=model,
            name=name or "Agent",
            system_prompt=system_prompt,
            dashboard_id=dashboard_id,
            cwd=cwd,
        )
        self.sessions[session.id] = session

        provider = get_provider(provider_id)
        await provider.start_session(session.id, model, system_prompt, cwd)

        save_session(session)
        await ws_manager.broadcast_dashboard(
            "agent:status",
            {
                "session_id": session.id,
                "status": session.status,
                "session": session.model_dump(),
            },
        )
        return session

    async def send_message(self, session_id: str, content: str) -> None:
        session = self.sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        # Add user message
        user_msg = Message(role="user", content=content)
        session.messages.append(user_msg)
        await ws_manager.send_to_session(
            session_id,
            "agent:message",
            {"session_id": session_id, "message": user_msg.model_dump()},
        )

        # Run agent in background task
        task = asyncio.create_task(self._run_agent(session_id, content))
        self._tasks[session_id] = task

    async def _run_agent(self, session_id: str, content: str) -> None:
        session = self.sessions[session_id]
        provider = get_provider(session.provider_id)
        session.status = "running"
        await ws_manager.send_to_session(
            session_id,
            "agent:status",
            {"session_id": session_id, "status": "running"},
        )

        current_message_id: str | None = None
        current_text = ""
        current_tool_calls: dict[str, dict] = {}

        try:
            async for event in provider.send_message(session_id, content):
                if isinstance(event, TextDelta):
                    if current_message_id != event.message_id:
                        # New message started — flush previous text if any
                        if current_message_id and current_text:
                            msg = Message(
                                id=current_message_id,
                                role="assistant",
                                content=current_text,
                            )
                            session.messages.append(msg)
                            await ws_manager.send_to_session(
                                session_id,
                                "agent:message",
                                {
                                    "session_id": session_id,
                                    "message": msg.model_dump(),
                                },
                            )
                        current_message_id = event.message_id
                        current_text = ""
                        await ws_manager.send_to_session(
                            session_id,
                            "agent:stream_start",
                            {
                                "session_id": session_id,
                                "message_id": event.message_id,
                                "role": "assistant",
                            },
                        )
                    current_text += event.text
                    await ws_manager.send_to_session(
                        session_id,
                        "agent:stream_delta",
                        {
                            "session_id": session_id,
                            "message_id": event.message_id,
                            "delta": event.text,
                        },
                    )

                elif isinstance(event, ToolCallStart):
                    current_tool_calls[event.tool_call_id] = {
                        "name": event.tool_name,
                        "input": "",
                    }
                    await ws_manager.send_to_session(
                        session_id,
                        "agent:stream_start",
                        {
                            "session_id": session_id,
                            "message_id": event.message_id,
                            "role": "tool_call",
                            "tool_name": event.tool_name,
                        },
                    )

                elif isinstance(event, ToolCallDelta):
                    if event.tool_call_id in current_tool_calls:
                        current_tool_calls[event.tool_call_id][
                            "input"
                        ] += event.partial_json
                    await ws_manager.send_to_session(
                        session_id,
                        "agent:stream_delta",
                        {
                            "session_id": session_id,
                            "message_id": event.message_id,
                            "delta": event.partial_json,
                        },
                    )

                elif isinstance(event, ToolCallComplete):
                    tc_msg = Message(
                        id=event.message_id,
                        role="tool_call",
                        content=event.arguments,
                        tool_name=event.tool_name,
                        tool_call_id=event.tool_call_id,
                    )
                    session.messages.append(tc_msg)
                    await ws_manager.send_to_session(
                        session_id,
                        "agent:stream_end",
                        {
                            "session_id": session_id,
                            "message_id": event.message_id,
                        },
                    )
                    await ws_manager.send_to_session(
                        session_id,
                        "agent:message",
                        {
                            "session_id": session_id,
                            "message": tc_msg.model_dump(),
                        },
                    )

                elif isinstance(event, CostUpdate):
                    session.cost_usd = event.cost_usd
                    session.tokens = {
                        "input": event.input_tokens,
                        "output": event.output_tokens,
                    }
                    await ws_manager.send_to_session(
                        session_id,
                        "agent:cost_update",
                        {
                            "session_id": session_id,
                            "cost_usd": event.cost_usd,
                            "tokens": session.tokens,
                        },
                    )

                elif isinstance(event, TurnComplete):
                    # Finalize any remaining text
                    if current_text and current_message_id:
                        msg = Message(
                            id=current_message_id,
                            role="assistant",
                            content=current_text,
                        )
                        session.messages.append(msg)
                        await ws_manager.send_to_session(
                            session_id,
                            "agent:stream_end",
                            {
                                "session_id": session_id,
                                "message_id": current_message_id,
                            },
                        )
                        await ws_manager.send_to_session(
                            session_id,
                            "agent:message",
                            {
                                "session_id": session_id,
                                "message": msg.model_dump(),
                            },
                        )

                    if event.error:
                        session.status = "error"
                    elif event.stop_reason == "end_turn":
                        session.status = "completed"
                    else:
                        session.status = "completed"

        except Exception as e:
            logger.exception("Agent error for session %s", session_id)
            session.status = "error"
            err_msg = Message(role="system", content=f"Error: {e}")
            session.messages.append(err_msg)
            await ws_manager.send_to_session(
                session_id,
                "agent:message",
                {"session_id": session_id, "message": err_msg.model_dump()},
            )

        save_session(session)
        await ws_manager.send_to_session(
            session_id,
            "agent:status",
            {
                "session_id": session_id,
                "status": session.status,
                "session": session.model_dump(),
            },
        )

    async def stop_session(self, session_id: str) -> None:
        session = self.sessions.get(session_id)
        if not session:
            return
        # Cancel background task
        task = self._tasks.get(session_id)
        if task and not task.done():
            task.cancel()
        # Stop provider
        provider = get_provider(session.provider_id)
        await provider.stop_session(session_id)
        session.status = "stopped"
        await ws_manager.send_to_session(
            session_id,
            "agent:status",
            {"session_id": session_id, "status": "stopped"},
        )

    def get_session(self, session_id: str) -> AgentSession | None:
        return self.sessions.get(session_id)

    def list_sessions(self) -> list[AgentSession]:
        return list(self.sessions.values())

    async def delete_session(self, session_id: str) -> None:
        await self.stop_session(session_id)
        self.sessions.pop(session_id, None)
        delete_session_file(session_id)

    async def invoke_agent(
        self,
        provider_id: str,
        model: str,
        message: str,
        parent_session_id: str | None = None,
        system_prompt: str | None = None,
    ) -> dict:
        """Spawn a sub-agent, send it a message, wait for completion, return result."""
        session = await self.create_session(
            provider_id=provider_id,
            model=model,
            name="Sub-agent",
            system_prompt=system_prompt,
            cwd=None,
        )
        session.parent_session_id = parent_session_id
        save_session(session)

        # Notify canvas of parent-child relationship
        await ws_manager.broadcast_dashboard(
            "agent:spawned",
            {
                "session_id": session.id,
                "parent_session_id": parent_session_id,
                "session": session.model_dump(),
            },
        )

        # Run synchronously — send message and wait for completion
        user_msg = Message(role="user", content=message)
        session.messages.append(user_msg)
        await ws_manager.send_to_session(
            session.id,
            "agent:message",
            {"session_id": session.id, "message": user_msg.model_dump()},
        )

        # Run agent loop inline (not as background task)
        await self._run_agent(session.id, message)

        # Extract the last assistant message as the result
        assistant_msgs = [m for m in session.messages if m.role == "assistant"]
        result_text = assistant_msgs[-1].content if assistant_msgs else ""

        return {
            "session_id": session.id,
            "response": result_text,
            "cost_usd": session.cost_usd,
        }

    def restore_sessions(self) -> None:
        """Load persisted sessions from disk on startup."""
        for session in load_all_sessions():
            # Mark any previously-running sessions as stopped
            if session.status == "running":
                session.status = "stopped"
            self.sessions[session.id] = session
        logger.info("Restored %d sessions from disk", len(self.sessions))


agent_manager = AgentManager()
