import json
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WSManager:
    def __init__(self) -> None:
        self.dashboard_connections: list[WebSocket] = []
        self.session_connections: dict[str, list[WebSocket]] = {}

    async def connect_dashboard(self, ws: WebSocket) -> None:
        await ws.accept()
        self.dashboard_connections.append(ws)

    def disconnect_dashboard(self, ws: WebSocket) -> None:
        if ws in self.dashboard_connections:
            self.dashboard_connections.remove(ws)

    async def connect_session(self, session_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.session_connections.setdefault(session_id, []).append(ws)

    def disconnect_session(self, session_id: str, ws: WebSocket) -> None:
        if session_id in self.session_connections:
            conns = self.session_connections[session_id]
            if ws in conns:
                conns.remove(ws)

    async def send_to_session(
        self, session_id: str, event: str, data: dict
    ) -> None:
        msg = json.dumps(
            {"event": event, "session_id": session_id, "data": data}
        )
        # Send to session-specific connections
        for ws in self.session_connections.get(session_id, []):
            try:
                await ws.send_text(msg)
            except Exception:
                logger.debug("Failed to send to session ws", exc_info=True)
        # Also broadcast to dashboard connections
        for ws in self.dashboard_connections:
            try:
                await ws.send_text(msg)
            except Exception:
                logger.debug("Failed to send to dashboard ws", exc_info=True)

    async def broadcast_dashboard(self, event: str, data: dict) -> None:
        msg = json.dumps({"event": event, "data": data})
        for ws in self.dashboard_connections:
            try:
                await ws.send_text(msg)
            except Exception:
                logger.debug("Failed to broadcast to dashboard ws", exc_info=True)


ws_manager = WSManager()
