# MergeCard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-agent canvas card (`MergeCard`) that joins multiple inbound edges into a single composed downstream message. Wait-for-all semantics with per-card timeout. Replaces the per-edge picker's multi-upstream surface with an explicit graph node.

**Architecture:** Mirrors the existing GateCard pattern end-to-end (model + storage + manager + REST + WebSocket + Redux slice + xyflow node). New `merge_manager.py` collects per-slot text keyed by upstream display name, snapshots `expected_slots` on first input of a round, fires emission via the existing `route_to_downstream` once all slots are filled, fails the card on timeout. Template renderer reuses the JSON-walking helper extracted from `_apply_transform`. Frontend's `upstreamPicker` collapses to single-upstream-only.

**Tech Stack:** FastAPI + Pydantic backend, asyncio for timeouts; React 19 + Redux Toolkit + xyflow frontend. No test framework configured — verification by runnable Python script + manual UI smoke.

**Spec:** `docs/superpowers/specs/2026-05-04-merge-card-design.md`

**Reference implementations to mirror:**
- Backend: `backend/agents/gate_manager.py` (191 lines), `backend/agents/models.py:98-108` (GateCard), `backend/sessions/store.py:147-188` (gate_cards storage helpers), `backend/main.py:377-432` (gate-cards REST routes).
- Frontend: `frontend/src/shared/state/gateCardsSlice.ts` (67 lines), `frontend/src/app/pages/Canvas/GateCardComponent.tsx` (360 lines), `frontend/src/app/pages/Canvas/xyflow/nodes.tsx:7,43` (registration).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/agents/models.py` | Modify | Add `MergeCard` Pydantic model after `GateCard` |
| `backend/sessions/store.py` | Modify | Add `_merge_cards_dir`, `save_merge_card`, `load_merge_card`, `load_all_merge_cards`, `delete_merge_card_file` |
| `backend/agents/merge_manager.py` | Create | CRUD + `receive_input` + `_emit` + `_timeout` + `reset`. Module-level `merge_manager` singleton. |
| `backend/agents/agent_manager.py` | Modify | Extract shared `_lookup_path` helper; add `_apply_template_with_slots`; add MergeCard branch to `_route_single` and `clear_downstream` |
| `backend/main.py` | Modify | Restore on startup; 5 REST routes (`POST/GET/PATCH/DELETE/POST/reset`) |
| `scripts/verify_merge_card.py` | Create | Standalone async script exercising slot fill / timeout / reset / template render |
| `frontend/src/shared/state/mergeCardsSlice.ts` | Create | Mirrors `gateCardsSlice.ts` |
| `frontend/src/shared/state/store.ts` | Modify | Wire `mergeCardsReducer` |
| `frontend/src/shared/ws/WebSocketManager.ts` | Modify | Dispatch `merge_card:update` |
| `frontend/src/app/pages/Canvas/MergeCardComponent.tsx` | Create | Node body — slot grid, template editor, last-emission preview, reset button |
| `frontend/src/app/pages/Canvas/xyflow/nodes.tsx` | Modify | Register `merge` node type |
| `frontend/src/app/pages/Canvas/Toolbar.tsx` | Modify | `+ Merge Card` button next to `+ Gate Card` |
| `frontend/src/app/pages/Canvas/upstreamPicker.tsx` | Modify | Drop dropdown — single immediate-upstream view |
| `frontend/src/app/pages/Canvas/Canvas.tsx` | Modify | `upstreamNodes` → `immediateUpstream` (single value); drop `useSelector(s.agents.sessions)` |
| `docs/workflows.md` | Modify | New "Merge Cards" subsection; update Transform expressions note about picker simplification |

---

## Task 1: Backend — `MergeCard` model + storage helpers

**Files:**
- Modify: `backend/agents/models.py` (insert after the `GateCard` class, around line 109)
- Modify: `backend/sessions/store.py` (insert after the gate-card helpers, around line 188)

- [ ] **Step 1: Add the model**

In `backend/agents/models.py`, after the `GateCard` class (the line `created_at: float = Field(default_factory=lambda: datetime.now().timestamp())` for GateCard ends around line 108), insert:

```python
class MergeCard(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str = "Merge"
    template: str = ""
    timeout_seconds: int = 60  # 0 = wait forever
    slots: dict[str, str] = Field(default_factory=dict)        # name.lower() → latest text per round
    expected_slots: list[str] = Field(default_factory=list)    # snapshot at first input of round; cleared on emit/reset
    status: Literal["idle", "waiting", "completed", "error"] = "idle"
    error_text: Optional[str] = None
    last_emitted_at: Optional[float] = None
    last_emitted_text: Optional[str] = None
    dashboard_id: Optional[str] = None
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())
```

Confirm `Literal`, `Optional`, `Field`, `BaseModel`, `uuid4`, `datetime` are already imported at the top — they are (used by `GateCard`). No new imports.

- [ ] **Step 2: Add storage helpers**

In `backend/sessions/store.py`, after the gate-card helpers (the function `delete_gate_card_file` ends around line 188), insert:

```python
def _merge_cards_dir() -> Path:
    d = _data_dir() / "merge_cards"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_merge_card(card: MergeCard) -> None:
    path = _merge_cards_dir() / f"{card.id}.json"
    path.write_text(card.model_dump_json(indent=2))


def load_merge_card(card_id: str) -> MergeCard | None:
    path = _merge_cards_dir() / f"{card_id}.json"
    if not path.exists():
        return None
    try:
        return MergeCard.model_validate_json(path.read_text())
    except Exception:
        return None


def load_all_merge_cards() -> list[MergeCard]:
    cards: list[MergeCard] = []
    for path in _merge_cards_dir().glob("*.json"):
        try:
            cards.append(MergeCard.model_validate_json(path.read_text()))
        except Exception:
            continue
    return cards


def delete_merge_card_file(card_id: str) -> None:
    path = _merge_cards_dir() / f"{card_id}.json"
    if path.exists():
        path.unlink()
```

Then update the import at the top of `backend/sessions/store.py` (line 10) — add `MergeCard` to the existing import list:

```python
from backend.agents.models import AgentSession, CardGroup, CardPosition, Connection, DialogueCard, GateCard, InputCard, MergeCard, ViewCard
```

- [ ] **Step 3: Quick sanity check**

```bash
cd /home/barrulus/dev/agentcanvas && python -c "
from backend.agents.models import MergeCard
from backend.sessions.store import save_merge_card, load_merge_card, delete_merge_card_file
c = MergeCard(name='test', template='Hello {{slot.A}}', dashboard_id='d1')
save_merge_card(c)
loaded = load_merge_card(c.id)
assert loaded is not None and loaded.name == 'test' and loaded.timeout_seconds == 60
delete_merge_card_file(c.id)
assert load_merge_card(c.id) is None
print('ok')
"
```

Expected: `ok`. If the data dir doesn't exist yet, `_merge_cards_dir()` creates it.

- [ ] **Step 4: Commit**

```bash
git add backend/agents/models.py backend/sessions/store.py
git commit -m "MergeCard: model + storage helpers"
```

NO `Co-Authored-By` line (user's CLAUDE.md prohibits it).

---

## Task 2: Backend — `merge_manager.py`

**Files:**
- Create: `backend/agents/merge_manager.py`

- [ ] **Step 1: Create the file**

```python
"""Merge card manager — collects per-slot inputs and emits a composed message."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from backend.agents.models import MergeCard
from backend.agents.ws_manager import ws_manager
from backend.sessions.store import (
    delete_merge_card_file,
    load_all_merge_cards,
    load_dashboard_connections,
    load_merge_card,
    save_merge_card,
)

if TYPE_CHECKING:
    from backend.agents.agent_manager import AgentManager

logger = logging.getLogger(__name__)


class MergeManager:
    def __init__(self) -> None:
        self.cards: dict[str, MergeCard] = {}
        self._timers: dict[str, asyncio.Task] = {}

    # --- CRUD ---

    def create_merge_card(
        self,
        name: str = "Merge",
        template: str = "",
        timeout_seconds: int = 60,
        dashboard_id: str | None = None,
    ) -> MergeCard:
        card = MergeCard(
            name=name,
            template=template,
            timeout_seconds=timeout_seconds,
            dashboard_id=dashboard_id,
        )
        self.cards[card.id] = card
        save_merge_card(card)
        return card

    def get_merge_card(self, card_id: str) -> MergeCard | None:
        return self.cards.get(card_id)

    def update_merge_card(self, card_id: str, updates: dict) -> MergeCard | None:
        card = self.cards.get(card_id)
        if not card:
            return None
        for key, val in updates.items():
            if hasattr(card, key) and key not in ("id", "created_at", "slots", "expected_slots", "status"):
                setattr(card, key, val)
        save_merge_card(card)
        return card

    def delete_merge_card(self, card_id: str) -> None:
        self._cancel_timer(card_id)
        self.cards.pop(card_id, None)
        delete_merge_card_file(card_id)

    def list_merge_cards(self, dashboard_id: str | None = None) -> list[MergeCard]:
        cards = list(self.cards.values())
        if dashboard_id:
            cards = [c for c in cards if c.dashboard_id == dashboard_id]
        return cards

    def restore_merge_cards(self) -> None:
        for card in load_all_merge_cards():
            # Persisted `waiting` state can't be re-armed without a new input,
            # but slot data is preserved for inspection. Status stays as-is.
            self.cards[card.id] = card
        logger.info("Restored %d merge cards", len(self.cards))

    # --- Pipeline ---

    async def receive_input(
        self,
        card_id: str,
        upstream_name: str,
        text: str,
        agent_mgr: "AgentManager",
    ) -> None:
        """Called when a routed output arrives at a merge card."""
        card = self.cards.get(card_id)
        if not card or not card.dashboard_id:
            return

        # Snapshot expected_slots on the first input of a round.
        if not card.expected_slots:
            card.expected_slots = self._compute_expected(card_id, agent_mgr)
            if not card.expected_slots:
                logger.warning("Merge card %s has no resolvable inbound names; ignoring input", card_id)
                return

        key = upstream_name.lower()
        card.slots[key] = text  # latest-wins on duplicate
        card.status = "waiting"
        save_merge_card(card)
        await self._broadcast(card)

        if set(card.slots) >= set(card.expected_slots):
            await self._emit(card_id, agent_mgr)
        else:
            self._arm_timer(card_id)

    def _compute_expected(self, card_id: str, agent_mgr: "AgentManager") -> list[str]:
        """All direct-inbound upstream names (lowercase), sorted, deduped, first-match-wins on collision."""
        from backend.agents.agent_manager import _resolve_card_name  # added in Task 3
        card = self.cards.get(card_id)
        if not card or not card.dashboard_id:
            return []
        connections = load_dashboard_connections(card.dashboard_id)
        inbound = [c for c in connections if c.to_card_id == card_id]
        seen: set[str] = set()
        out: list[str] = []
        for c in inbound:
            name = _resolve_card_name(c.from_card_id, agent_mgr)
            if not name:
                continue
            key = name.lower()
            if key in seen:
                logger.warning("MergeCard %s: duplicate upstream name %r — keeping first", card_id, name)
                continue
            seen.add(key)
            out.append(key)
        return sorted(out)

    async def _emit(self, card_id: str, agent_mgr: "AgentManager") -> None:
        card = self.cards.get(card_id)
        if not card:
            return
        from backend.agents.agent_manager import (
            _apply_template_with_slots,
            route_to_downstream,
        )

        rendered = _apply_template_with_slots(card.template, card.slots)
        from datetime import datetime

        card.last_emitted_text = rendered
        card.last_emitted_at = datetime.now().timestamp()
        card.status = "completed"
        card.error_text = None
        card.slots = {}
        card.expected_slots = []
        save_merge_card(card)
        self._cancel_timer(card_id)
        await self._broadcast(card)

        if card.dashboard_id:
            await route_to_downstream(card_id, rendered, card.dashboard_id, agent_mgr)

    def _arm_timer(self, card_id: str) -> None:
        card = self.cards.get(card_id)
        if not card or card.timeout_seconds <= 0:
            return
        if card_id in self._timers and not self._timers[card_id].done():
            return  # already armed
        self._timers[card_id] = asyncio.create_task(self._timeout(card_id, card.timeout_seconds))

    def _cancel_timer(self, card_id: str) -> None:
        task = self._timers.pop(card_id, None)
        if task and not task.done():
            task.cancel()

    async def _timeout(self, card_id: str, after_s: int) -> None:
        try:
            await asyncio.sleep(after_s)
        except asyncio.CancelledError:
            return
        card = self.cards.get(card_id)
        if not card or card.status != "waiting":
            return
        missing = sorted(set(card.expected_slots) - set(card.slots))
        card.status = "error"
        card.error_text = f"Timeout after {after_s}s — missing: {', '.join(missing) or '(none)'}"
        save_merge_card(card)
        await self._broadcast(card)

    async def reset(self, card_id: str) -> None:
        card = self.cards.get(card_id)
        if not card:
            return
        self._cancel_timer(card_id)
        card.slots = {}
        card.expected_slots = []
        card.status = "idle"
        card.error_text = None
        save_merge_card(card)
        await self._broadcast(card)

    async def _broadcast(self, card: MergeCard) -> None:
        await ws_manager.broadcast_dashboard(
            "merge_card:update",
            {"card_id": card.id, "card": card.model_dump()},
        )


merge_manager = MergeManager()
```

- [ ] **Step 2: Sanity-check the file imports cleanly (`_resolve_card_name` and `_apply_template_with_slots` don't exist yet — they're added in Task 3, so this import is deferred via the function-scoped imports above and won't fire at module load).**

```bash
cd /home/barrulus/dev/agentcanvas && python -c "from backend.agents.merge_manager import merge_manager; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add backend/agents/merge_manager.py
git commit -m "MergeCard: manager with CRUD, slot collection, timeout, reset"
```

---

## Task 3: Backend — shared `_lookup_path`, `_resolve_card_name`, `_apply_template_with_slots`, and route wiring

**Files:**
- Modify: `backend/agents/agent_manager.py`

This task is the keystone — it adds the helpers `merge_manager.py` already references and wires the MergeCard branch into `_route_single` and `clear_downstream`.

- [ ] **Step 1: Extract `_lookup_path` to module scope**

The current `_apply_transform` (around `backend/agents/agent_manager.py:959`) defines `_lookup_path` as a closure inside the method. Move it to module scope so both `_apply_transform` and the new `_apply_template_with_slots` can share it.

Insert at module scope, just below the existing `_last_assistant_text` helper (around line 137):

```python
def _lookup_path(parsed: object, path_parts: list[str]) -> str | None:
    """Walk a JSON-decoded structure by dot-path. Returns string-coerced leaf, or None."""
    val: object = parsed
    for key in path_parts:
        if isinstance(val, dict) and key in val:
            val = val[key]
        else:
            return None
    return val if isinstance(val, str) else __import__("json").dumps(val)
```

(Using `__import__("json").dumps` keeps the helper self-contained; feel free to use the module-level `json` import that already exists at the top of the file — `import json` is already on line 2.)

Cleaner version using the existing `json` import:

```python
def _lookup_path(parsed: object, path_parts: list[str]) -> str | None:
    """Walk a JSON-decoded structure by dot-path. Returns string-coerced leaf, or None."""
    val: object = parsed
    for key in path_parts:
        if isinstance(val, dict) and key in val:
            val = val[key]
        else:
            return None
    return val if isinstance(val, str) else json.dumps(val)
```

Use the cleaner version.

Then **delete** the `_lookup_path` closure inside `_apply_transform` (the `def _lookup_path(...)` block currently nested inside the method) and update its two call sites inside `_apply_transform` to call the module-level function directly. Existing call sites are inside `replace`'s `output.` branch and the `nodes.` branch.

- [ ] **Step 2: Add `_resolve_card_name` helper**

Just below `_lookup_path`, add:

```python
def _resolve_card_name(card_id: str, agent_mgr: "AgentManager") -> str | None:
    """Resolve a card id to its display name across agent / gate / dialogue / view / input / merge cards."""
    session = agent_mgr.sessions.get(card_id)
    if session:
        return session.name
    from backend.agents.gate_manager import gate_manager
    gc = gate_manager.get_gate_card(card_id)
    if gc:
        return gc.name
    from backend.agents.dialogue_manager import dialogue_manager
    dc = dialogue_manager.get_dialogue_card(card_id)
    if dc:
        return dc.name
    from backend.agents.merge_manager import merge_manager
    mc = merge_manager.get_merge_card(card_id)
    if mc:
        return mc.name
    from backend.sessions.store import load_view_card, load_input_card
    vc = load_view_card(card_id)
    if vc:
        return vc.name
    ic = load_input_card(card_id)
    if ic:
        return ic.name
    return None
```

This duplicates the existing closure `_get_target_name` at `route_to_downstream` line ~183 but with merge-card support added. Replace the inner closure to delegate to this module-level helper:

Find `_get_target_name` inside `route_to_downstream` (around line 183) and replace its body with:

```python
    def _get_target_name(target_id: str) -> str | None:
        return _resolve_card_name(target_id, agent_mgr)
```

(Keep the closure for backwards-compat with the existing call sites at lines 209 and 227; only the implementation changes.)

- [ ] **Step 3: Add `_apply_template_with_slots`**

Insert at module scope just below `_resolve_card_name`:

```python
def _apply_template_with_slots(template: str, slots: dict[str, str]) -> str:
    """Render a MergeCard template.

    Supported placeholders:
    - {{slot.<Name>}} — full text of the slot keyed by name.lower()
    - {{slot.<Name>.field}} — JSON dot-path into the slot's parsed output

    Failure modes (unknown slot, missing field, non-JSON) leave the placeholder intact.
    """
    def replace(match: re.Match) -> str:
        expr = match.group(1).strip()
        if not expr.startswith("slot."):
            return match.group(0)
        rest = expr[len("slot."):]
        if "." in rest:
            name, _, path = rest.partition(".")
            path_parts = path.split(".") if path else []
        else:
            name, path_parts = rest, []
        slot_text = slots.get(name.strip().lower())
        if slot_text is None:
            return match.group(0)
        if not path_parts:
            return slot_text
        parsed = AgentManager._extract_json(slot_text)
        if not isinstance(parsed, dict):
            return match.group(0)
        resolved = _lookup_path(parsed, path_parts)
        return resolved if resolved is not None else match.group(0)

    return re.sub(r"\{\{([^{}]+)\}\}", replace, template)
```

- [ ] **Step 4: Add MergeCard branch to `_route_single`**

In `route_to_downstream`'s `_route_single` inner function, locate the dialogue-card branch (around line 309-313):

```python
        # Target is a dialogue card
        from backend.agents.dialogue_manager import dialogue_manager
        dialogue_card = dialogue_manager.get_dialogue_card(target_id)
        if dialogue_card:
            await dialogue_manager.receive_input(target_id, conn.id, routed_text)
            return
```

Insert this **immediately after** that block (before the view-card branch):

```python
        # Target is a merge card
        from backend.agents.merge_manager import merge_manager
        merge_card = merge_manager.get_merge_card(target_id)
        if merge_card:
            upstream_name = _resolve_card_name(from_card_id, agent_mgr)
            if upstream_name is None:
                logger.warning("MergeCard %s: ignoring input from unnamed source %s", target_id, from_card_id)
                return
            await merge_manager.receive_input(target_id, upstream_name, routed_text, agent_mgr)
            return
```

- [ ] **Step 5: Add MergeCard branch to `clear_downstream`**

In `clear_downstream` (around line 80-126 in `agent_manager.py`), locate the dialogue-card clear branch (around lines 108-114):

```python
        # Clear dialogue card
        from backend.agents.dialogue_manager import dialogue_manager
        dialogue_card = dialogue_manager.get_dialogue_card(target_id)
        if dialogue_card:
            await dialogue_manager.reset(target_id)
            await clear_downstream(target_id, dashboard_id, agent_mgr, visited)
            continue
```

Insert immediately after that block:

```python
        # Clear merge card
        from backend.agents.merge_manager import merge_manager
        merge_card = merge_manager.get_merge_card(target_id)
        if merge_card:
            await merge_manager.reset(target_id)
            await clear_downstream(target_id, dashboard_id, agent_mgr, visited)
            continue
```

- [ ] **Step 6: Sanity-check imports + back-compat**

```bash
cd /home/barrulus/dev/agentcanvas && python -c "
from backend.agents.agent_manager import (
    _lookup_path, _resolve_card_name, _apply_template_with_slots, AgentManager, route_to_downstream
)
print('imports ok')
# back-compat
print('back-compat output:', AgentManager._apply_transform('{{output.s}}', '{\"s\":\"yes\"}', None) == 'yes')
print('back-compat nodes:', AgentManager._apply_transform('{{nodes.X.output}}', '', {'x': 'val'}) == 'val')
# new
print('slot full:', _apply_template_with_slots('hi {{slot.A}}', {'a': 'world'}) == 'hi world')
print('slot path:', _apply_template_with_slots('{{slot.X.t}}', {'x': '{\"t\":\"T\"}'}) == 'T')
print('slot unknown:', _apply_template_with_slots('{{slot.Ghost}}', {}) == '{{slot.Ghost}}')
"
```

All five must print `True` (or `imports ok` for the first line).

- [ ] **Step 7: Run the existing Phase E verifier — it must still pass**

```bash
cd /home/barrulus/dev/agentcanvas && python -m scripts.verify_expression_language
```

Expected: `14/14 passed`.

- [ ] **Step 8: Commit**

```bash
git add backend/agents/agent_manager.py
git commit -m "MergeCard: shared template helpers + route_to_downstream + clear_downstream wiring"
```

---

## Task 4: Backend — REST routes + startup restore

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Restore on startup**

Find the existing `gate_manager.restore_gate_cards()` call (around line 27 inside the startup hook). Add immediately after it:

```python
    from backend.agents.merge_manager import merge_manager
    merge_manager.restore_merge_cards()
```

- [ ] **Step 2: Add the five REST routes**

After the gate-cards routes (the last gate-card route is `POST /api/gate-cards/{card_id}/reset`, ending around line 432), insert:

```python
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
```

- [ ] **Step 3: Sanity check**

```bash
cd /home/barrulus/dev/agentcanvas && python -c "
from backend.main import app
routes = [r.path for r in app.routes]
required = [
    '/api/merge-cards',
    '/api/merge-cards/{card_id}',
    '/api/merge-cards/{card_id}/reset',
]
for r in required:
    assert r in routes, f'missing {r}'
print('routes ok')
"
```

Expected: `routes ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "MergeCard: REST routes + startup restore"
```

---

## Task 5: Backend — verification script

**Files:**
- Create: `scripts/verify_merge_card.py`

- [ ] **Step 1: Create the script**

```python
"""Verify MergeCard end-to-end: slot fill → emit, partial → timeout → error → reset.

Run from repo root:  python -m scripts.verify_merge_card
Exits non-zero on any failure.
"""
from __future__ import annotations

import asyncio
import sys
from unittest.mock import patch

from backend.agents.agent_manager import _apply_template_with_slots
from backend.agents.merge_manager import merge_manager
from backend.agents.models import Connection
from backend.sessions.store import delete_merge_card_file


async def run() -> int:
    failures = 0

    # 1. Template renderer
    cases = [
        ("slot full",      "Hello {{slot.A}}",        {"a": "world"},               "Hello world"),
        ("slot JSON",      "{{slot.X.title}}",        {"x": '{"title":"T"}'},        "T"),
        ("slot unknown",   "{{slot.Ghost}}",          {},                            "{{slot.Ghost}}"),
        ("slot non-JSON",  "{{slot.X.f}}",            {"x": "plain"},                "{{slot.X.f}}"),
        ("nested",         "{{slot.X.a.b}}",          {"x": '{"a":{"b":"deep"}}'},   "deep"),
        ("case-insens",    "{{slot.alice}}",          {"alice": "x"},                "x"),
        ("non-slot left",  "{{output}}",              {"output": "ignored"},         "{{output}}"),
    ]
    for label, template, slots, expected in cases:
        got = _apply_template_with_slots(template, slots)
        ok = got == expected
        print(f"[{'PASS' if ok else 'FAIL'}] template — {label}")
        if not ok:
            print(f"    expected: {expected!r}")
            print(f"    got:      {got!r}")
            failures += 1

    # 2. Manager flow
    card = merge_manager.create_merge_card(
        name="TestMerge",
        template="P:{{slot.A}} | C:{{slot.B}}",
        timeout_seconds=2,
        dashboard_id="test_dash",
    )

    class FakeAgentMgr:
        sessions: dict = {}

    fake_mgr = FakeAgentMgr()

    fake_connections = [
        Connection(id="c1", from_card_id="src_a", to_card_id=card.id),
        Connection(id="c2", from_card_id="src_b", to_card_id=card.id),
    ]
    routed: list[tuple[str, str]] = []

    async def fake_route(from_id, content, dashboard_id, agent_mgr):
        routed.append((from_id, content))

    with patch("backend.sessions.store.load_dashboard_connections", return_value=fake_connections), \
         patch("backend.agents.agent_manager._resolve_card_name", side_effect=lambda cid, _mgr: {"src_a": "A", "src_b": "B"}.get(cid)), \
         patch("backend.agents.agent_manager.route_to_downstream", side_effect=fake_route):
        # 2a. Single input → status waiting, not emitted
        await merge_manager.receive_input(card.id, "A", "alpha", fake_mgr)  # type: ignore[arg-type]
        ok = card.status == "waiting" and card.slots == {"a": "alpha"} and card.expected_slots == ["a", "b"] and not routed
        print(f"[{'PASS' if ok else 'FAIL'}] manager — single input pending")
        if not ok:
            print(f"    status={card.status} slots={card.slots} expected={card.expected_slots} routed={routed}")
            failures += 1

        # 2b. Second input → status completed, emission with rendered template
        await merge_manager.receive_input(card.id, "B", "beta", fake_mgr)  # type: ignore[arg-type]
        ok = card.status == "completed" and card.slots == {} and card.expected_slots == [] and routed == [(card.id, "P:alpha | C:beta")]
        print(f"[{'PASS' if ok else 'FAIL'}] manager — full input emits")
        if not ok:
            print(f"    status={card.status} slots={card.slots} expected={card.expected_slots} routed={routed}")
            failures += 1

        # 2c. Partial input → wait for timeout → error
        routed.clear()
        await merge_manager.receive_input(card.id, "A", "alpha2", fake_mgr)  # type: ignore[arg-type]
        await asyncio.sleep(2.5)  # wait past timeout
        ok = card.status == "error" and "Timeout" in (card.error_text or "") and "b" in (card.error_text or "") and not routed
        print(f"[{'PASS' if ok else 'FAIL'}] manager — timeout fails")
        if not ok:
            print(f"    status={card.status} error_text={card.error_text} routed={routed}")
            failures += 1

        # 2d. Reset re-arms
        await merge_manager.reset(card.id)
        ok = card.status == "idle" and card.slots == {} and card.expected_slots == [] and card.error_text is None
        print(f"[{'PASS' if ok else 'FAIL'}] manager — reset clears state")
        if not ok:
            print(f"    status={card.status} slots={card.slots} expected={card.expected_slots} error={card.error_text}")
            failures += 1

    # Cleanup
    merge_manager.delete_merge_card(card.id)
    delete_merge_card_file(card.id)

    print(f"\n{'PASS' if failures == 0 else 'FAIL'} ({failures} failure(s))")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
```

- [ ] **Step 2: Run it**

```bash
cd /home/barrulus/dev/agentcanvas && python -m scripts.verify_merge_card
```

Expected: all `[PASS]`, exit 0. The script takes ~3 seconds (one `asyncio.sleep(2.5)` in the timeout test).

- [ ] **Step 3: Commit**

```bash
git add scripts/verify_merge_card.py
git commit -m "MergeCard: verification script for template + manager flow"
```

---

## Task 6: Frontend — `mergeCardsSlice`

**Files:**
- Create: `frontend/src/shared/state/mergeCardsSlice.ts`
- Modify: `frontend/src/shared/state/store.ts`
- Modify: `frontend/src/shared/ws/WebSocketManager.ts`

- [ ] **Step 1: Create the slice**

```ts
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export interface MergeCard {
  id: string
  name: string
  template: string
  timeout_seconds: number
  slots: Record<string, string>
  expected_slots: string[]
  status: 'idle' | 'waiting' | 'completed' | 'error'
  error_text?: string | null
  last_emitted_at?: number | null
  last_emitted_text?: string | null
  dashboard_id?: string
  created_at: number
}

interface MergeCardsState {
  cards: Record<string, MergeCard>
}

const initialState: MergeCardsState = {
  cards: {},
}

export const fetchMergeCards = createAsyncThunk('mergeCards/fetch', async (dashboardId?: string) => {
  const url = dashboardId ? `/api/merge-cards?dashboard_id=${dashboardId}` : '/api/merge-cards'
  const res = await fetch(url)
  const data = await res.json()
  return data.merge_cards as MergeCard[]
})

export const createMergeCard = createAsyncThunk(
  'mergeCards/create',
  async (params: { name?: string; template?: string; timeout_seconds?: number; dashboard_id?: string }) => {
    const res = await fetch('/api/merge-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return await res.json() as MergeCard
  },
)

export const updateMergeCard = createAsyncThunk(
  'mergeCards/update',
  async ({ id, updates }: { id: string; updates: Partial<Pick<MergeCard, 'name' | 'template' | 'timeout_seconds'>> }) => {
    const res = await fetch(`/api/merge-cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    return await res.json() as MergeCard
  },
)

export const resetMergeCard = createAsyncThunk('mergeCards/reset', async (id: string) => {
  await fetch(`/api/merge-cards/${id}/reset`, { method: 'POST' })
  return id
})

const mergeCardsSlice = createSlice({
  name: 'mergeCards',
  initialState,
  reducers: {
    setMergeCard(state, action: PayloadAction<MergeCard>) {
      state.cards[action.payload.id] = action.payload
    },
    removeMergeCard(state, action: PayloadAction<string>) {
      delete state.cards[action.payload]
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchMergeCards.fulfilled, (state, action) => {
      for (const c of action.payload) state.cards[c.id] = c
    })
    builder.addCase(createMergeCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
    builder.addCase(updateMergeCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
  },
})

export const { setMergeCard, removeMergeCard } = mergeCardsSlice.actions
export const mergeCardsReducer = mergeCardsSlice.reducer
```

- [ ] **Step 2: Wire into store**

In `frontend/src/shared/state/store.ts`, find the existing `gateCardsReducer` import + reducer entry. Add alongside:

```ts
import { mergeCardsReducer } from './mergeCardsSlice'
```

And in the `configureStore({ reducer: { ... } })` block, add a `mergeCards: mergeCardsReducer,` entry next to `gateCards`.

- [ ] **Step 3: Wire WebSocket dispatch**

In `frontend/src/shared/ws/WebSocketManager.ts`:

(a) Add import:
```ts
import { setMergeCard } from '../state/mergeCardsSlice'
```

(b) Find the existing `case 'gate_card:update':` block (around line 100). Immediately after its `break`, add:

```ts
      case 'merge_card:update':
        store.dispatch(setMergeCard(payload.card))
        break
```

(Use the same `store.dispatch(...)` form you find in the gate case — the actual identifier may be `store` or some imported alias; mirror exactly.)

- [ ] **Step 4: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npx tsc --noEmit 2>&1 | tail -10
```

Expected: no new errors related to `mergeCardsSlice`, `store.ts`, or `WebSocketManager.ts`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/state/mergeCardsSlice.ts frontend/src/shared/state/store.ts frontend/src/shared/ws/WebSocketManager.ts
git commit -m "MergeCard: Redux slice + store + websocket dispatch"
```

---

## Task 7: Frontend — `MergeCardComponent`

**Files:**
- Create: `frontend/src/app/pages/Canvas/MergeCardComponent.tsx`
- Modify: `frontend/src/app/pages/Canvas/xyflow/nodes.tsx`

- [ ] **Step 1: Create the component**

Mirror the structure of `frontend/src/app/pages/Canvas/GateCardComponent.tsx`. The component receives a `card` prop and a `chromeless?: boolean` flag (rendered inside `CardWrapper`). Required UI:

```tsx
import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { MergeCard, updateMergeCard, resetMergeCard, removeMergeCard } from '@/shared/state/mergeCardsSlice'

const STATUS_COLORS: Record<MergeCard['status'], string> = {
  idle: '#666',
  waiting: '#4fc3f7',
  completed: '#66bb6a',
  error: '#ef5350',
}

export function MergeCardComponent({ card, chromeless = false }: { card: MergeCard; chromeless?: boolean }) {
  const dispatch = useDispatch<AppDispatch>()
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(card.name)
  const [editTemplate, setEditTemplate] = useState(card.template)
  const [editTimeout, setEditTimeout] = useState(card.timeout_seconds)

  const filled = Object.keys(card.slots).length
  const expected = card.expected_slots.length || 0
  const ratio = expected > 0 ? `${filled}/${expected}` : `${filled} slot${filled === 1 ? '' : 's'}`

  const onSave = async () => {
    await dispatch(updateMergeCard({
      id: card.id,
      updates: { name: editName, template: editTemplate, timeout_seconds: editTimeout },
    }))
    setEditing(false)
  }

  const onReset = () => dispatch(resetMergeCard(card.id))
  const onDelete = async () => {
    await fetch(`/api/merge-cards/${card.id}`, { method: 'DELETE' })
    dispatch(removeMergeCard(card.id))
  }

  return (
    <div style={{
      width: '100%', height: '100%', background: '#15152a',
      border: `1px solid ${STATUS_COLORS[card.status]}`, borderRadius: 12,
      display: 'flex', flexDirection: 'column', padding: 12, gap: 8, overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[card.status] }} />
        <strong style={{ flex: 1, color: '#e0e0e0', fontSize: 13 }}>{card.name}</strong>
        <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>merge · {ratio}</span>
        <button onClick={() => setEditing(true)} title="Edit" style={iconBtn}>&#9998;</button>
        <button onClick={onDelete} title="Delete" style={{ ...iconBtn, color: '#ef5350' }}>×</button>
      </div>

      {/* Slot grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
        {card.expected_slots.map(name => {
          const value = card.slots[name]
          const filled = value !== undefined
          return (
            <div key={name} style={{ display: 'flex', gap: 6, color: filled ? '#9fd9ff' : '#555' }}>
              <span style={{ width: 12 }}>{filled ? '✓' : '·'}</span>
              <span style={{ width: 90, fontWeight: 600 }}>{name}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {filled ? value.slice(0, 60) : '(waiting)'}
              </span>
            </div>
          )
        })}
        {card.expected_slots.length === 0 && (
          <span style={{ color: '#555', fontSize: 11 }}>No inbound edges yet — connect upstream agents.</span>
        )}
      </div>

      {card.status === 'error' && card.error_text && (
        <div style={{ background: '#3a1a1a', border: '1px solid #ef5350', borderRadius: 6, padding: 6, fontSize: 11, color: '#ef9a9a' }}>
          {card.error_text}
          <button onClick={onReset} style={{ marginLeft: 8, padding: '2px 8px', background: '#ef5350', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
            Reset
          </button>
        </div>
      )}

      {card.last_emitted_text && (
        <div style={{ marginTop: 4, padding: 6, background: '#0d1f0d', border: '1px solid #2a4a2a', borderRadius: 6, fontSize: 11, color: '#a0d0a0', maxHeight: 80, overflow: 'auto' }}>
          <div style={{ fontSize: 9, color: '#666', marginBottom: 2 }}>last emission</div>
          {card.last_emitted_text.slice(0, 240)}
        </div>
      )}

      {editing && (
        <div onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} style={{
          position: 'absolute', inset: 0, background: '#1a1a2eee',
          padding: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 20, borderRadius: 12, overflow: 'auto',
        }}>
          <strong style={{ color: '#e0e0e0', fontSize: 13 }}>Edit Merge Card</strong>

          <label style={{ fontSize: 11, color: '#888' }}>Name</label>
          <input value={editName} onChange={e => setEditName(e.target.value)} style={inputStyle} />

          <label style={{ fontSize: 11, color: '#888' }}>Template — use {`{{slot.<UpstreamName>[.field]}}`}</label>
          <textarea value={editTemplate} onChange={e => setEditTemplate(e.target.value)} style={{ ...inputStyle, minHeight: 100, fontFamily: 'monospace' }} />

          <label style={{ fontSize: 11, color: '#888' }}>Timeout seconds (0 = wait forever)</label>
          <input type="number" min={0} value={editTimeout} onChange={e => setEditTimeout(parseInt(e.target.value || '0', 10))} style={inputStyle} />

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => setEditing(false)} style={cancelBtn}>Cancel</button>
            <button onClick={onSave} style={saveBtn}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}

const iconBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, padding: '0 2px' }
const inputStyle: React.CSSProperties = { padding: '6px 10px', background: '#12121e', color: '#e0e0e0', border: '1px solid #333', borderRadius: 4, fontSize: 12 }
const cancelBtn: React.CSSProperties = { padding: '6px 12px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 4, cursor: 'pointer', fontSize: 12 }
const saveBtn: React.CSSProperties = { padding: '6px 12px', background: '#4fc3f7', color: '#000', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer', fontSize: 12 }
```

Note `chromeless` is accepted but unused (the gate component uses it the same way — present for type symmetry). Suppress with `// eslint-disable-next-line @typescript-eslint/no-unused-vars` or use `void chromeless` if linting complains.

- [ ] **Step 2: Register the node type**

In `frontend/src/app/pages/Canvas/xyflow/nodes.tsx`:

(a) Add import alongside `GateCardComponent`:
```tsx
import { MergeCardComponent } from '../MergeCardComponent'
```

(b) Look at how `gate` is registered (around line 43). The pattern is something like:
```tsx
gate: (props) => <CardWrapper id={props.id} render={(c) => <GateCardComponent card={c} chromeless />} />,
```

Add a parallel entry — but `MergeCardComponent` reads from `state.mergeCards.cards`, not the canvas card position. The `CardWrapper` wraps a generic card resolver. Inspect the `CardWrapper` component to see what `render` receives; if it expects a CardPosition, you'll need a small selector that hydrates the merge card from `state.mergeCards.cards[id]`. The simplest path:

```tsx
function MergeNodeWrapper({ id }: { id: string }) {
  const card = useSelector((s: RootState) => s.mergeCards.cards[id])
  if (!card) return null
  return <MergeCardComponent card={card} chromeless />
}

// in nodeTypes:
merge: ({ id }: NodeProps) => <MergeNodeWrapper id={id} />,
```

Place `MergeNodeWrapper` at the top of the file alongside any existing wrappers. Verify the actual `nodeTypes` shape matches — copy the gate registration's structure verbatim and substitute names.

- [ ] **Step 3: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npm run build 2>&1 | tail -15
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/pages/Canvas/MergeCardComponent.tsx frontend/src/app/pages/Canvas/xyflow/nodes.tsx
git commit -m "MergeCard: node component + xyflow registration"
```

---

## Task 8: Frontend — Toolbar button + dashboard hydration

**Files:**
- Modify: `frontend/src/app/pages/Canvas/Toolbar.tsx`
- Modify: any dashboard-load hook that currently calls `fetchGateCards` (search for it)

- [ ] **Step 1: Add Toolbar button**

Find the existing `+ Gate Card` button and the surrounding `createGateCard` import. Mirror its structure:

(a) Import:
```tsx
import { createMergeCard, fetchMergeCards } from '@/shared/state/mergeCardsSlice'
```

(b) Add a button next to `+ Gate Card`. The handler:

```tsx
const handleCreateMergeCard = async () => {
  const card = await dispatch(createMergeCard({ dashboard_id: currentDashboardId, template: '' })).unwrap()
  // Add a CardPosition at a default location so xyflow renders it.
  dispatch(addCard({ session_id: card.id, x: 200, y: 200, width: 320, height: 240, card_type: 'merge' }))
}
```

Match exactly how `+ Gate Card` adds its card position (search for `card_type: 'gate'` in `Toolbar.tsx`). The `card_type: 'merge'` value must also be added to the `CardPosition.card_type` literal union in `frontend/src/shared/state/canvasSlice.ts:100`:

```ts
card_type?: 'agent' | 'view' | 'input' | 'gate' | 'dialogue' | 'merge'
```

- [ ] **Step 2: Hydrate on dashboard load**

Search for where `fetchGateCards` is dispatched on dashboard load:

```bash
cd /home/barrulus/dev/agentcanvas && grep -rn "fetchGateCards" frontend/src/
```

Add a parallel `dispatch(fetchMergeCards(currentDashboardId))` right after each `fetchGateCards` call.

- [ ] **Step 3: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npm run build 2>&1 | tail -15
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/pages/Canvas/Toolbar.tsx frontend/src/shared/state/canvasSlice.ts
git commit -m "MergeCard: Toolbar button + canvas slice card_type + dashboard hydration"
```

---

## Task 9: Frontend — simplify upstreamPicker (drop sibling list)

**Files:**
- Modify: `frontend/src/app/pages/Canvas/upstreamPicker.tsx`
- Modify: `frontend/src/app/pages/Canvas/Canvas.tsx`

- [ ] **Step 1: Simplify the picker component**

Replace `frontend/src/app/pages/Canvas/upstreamPicker.tsx` with this version (note the API change: `upstream` is now a single value, not an array):

```tsx
import { useEffect, useMemo, useState } from 'react'

export type UpstreamNode = { id: string; name: string }

type LastRun = { response_out?: string | null }

function discoverPaths(json: unknown, prefix = '', depth = 0): string[] {
  if (depth > 3 || json === null || typeof json !== 'object' || Array.isArray(json)) return []
  return Object.entries(json as Record<string, unknown>).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k
    return [path, ...discoverPaths(v, path, depth + 1)]
  }).slice(0, 20)
}

function parseJsonLoose(text: string | null | undefined): unknown {
  if (!text) return null
  try {
    return JSON.parse(text.trim())
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}

export function UpstreamPicker({
  upstream,
  onInsert,
}: {
  upstream: UpstreamNode | null
  onInsert: (snippet: string) => void
}) {
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!upstream) { setLastRun(null); setError(null); return }
    let cancelled = false
    setError(null)
    fetch(`/api/sessions/${upstream.id}/last-run`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => { if (!cancelled) setLastRun(data) })
      .catch((e) => { if (!cancelled) { setLastRun(null); setError(String(e?.message ?? e)) } })
    return () => { cancelled = true }
  }, [upstream?.id])

  const paths = useMemo(() => {
    const parsed = parseJsonLoose(lastRun?.response_out ?? null)
    return discoverPaths(parsed)
  }, [lastRun])

  if (!upstream) return null

  return (
    <div style={{ marginBottom: 8, padding: 8, background: '#13132a', borderRadius: 6, border: '1px solid #2a2a44' }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
        Insert from <span style={{ color: '#9fd9ff', fontFamily: 'monospace' }}>{upstream.name}</span>:
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <button type="button" onClick={() => onInsert('{{output}}')} style={chipStyle} title="Insert full text">
          output
        </button>
        {paths.map((p) => (
          <button key={p} type="button" onClick={() => onInsert(`{{output.${p}}}`)} style={chipStyle} title={`Insert ${p}`}>
            {p}
          </button>
        ))}
        {paths.length === 0 && lastRun && (
          <span style={{ fontSize: 11, color: '#666' }}>No JSON fields detected in last output. Run the upstream once to populate.</span>
        )}
        {error && <span style={{ fontSize: 11, color: '#888' }}>Couldn't load output preview.</span>}
      </div>
    </div>
  )
}

const chipStyle: React.CSSProperties = {
  padding: '2px 8px',
  background: '#1f1f3a',
  color: '#9fd9ff',
  border: '1px solid #2a3a5a',
  borderRadius: 10,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'monospace',
}
```

- [ ] **Step 2: Update `Canvas.tsx` consumer**

In `frontend/src/app/pages/Canvas/Canvas.tsx`, find the `upstreamNodes` useMemo (added in Phase E around lines 65-83). Replace it with:

```tsx
  const immediateUpstream = useMemo<UpstreamNode | null>(() => {
    if (!editingConn) return null
    const conn = connections.find((c) => c.id === editingConn.connId)
    if (!conn) return null
    const name = sessions[conn.from]?.name
    if (!name) return null
    return { id: conn.from, name }
  }, [editingConn, connections, sessions])
```

`sessions` and `useSelector(...sessions)` remain. The `seen` / loop / `isImmediate` logic is gone.

Then find the `<UpstreamPicker upstream={upstreamNodes} ... />` usage and change `upstream={upstreamNodes}` to `upstream={immediateUpstream}`.

- [ ] **Step 3: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npm run build 2>&1 | tail -15
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/pages/Canvas/upstreamPicker.tsx frontend/src/app/pages/Canvas/Canvas.tsx
git commit -m "MergeCard: simplify upstream picker to immediate-source-only"
```

---

## Task 10: Docs

**Files:**
- Modify: `docs/workflows.md`

- [ ] **Step 1: Add the MergeCard subsection**

Insert a new `## Merge Cards` section in `docs/workflows.md`. Place it just before the existing `## Named Routing` heading (similar position to where Phase E's Transform expressions section landed). Content:

```markdown
## Merge Cards

A **MergeCard** is a non-agent node that joins multiple inbound edges into a single composed downstream message. Use it when one downstream agent needs data from two or more upstream agents in the same prompt.

```
Optimist  ─┐
           ├─→ MergeCard "Pros: {{slot.Optimist}} / Cons: {{slot.Pessimist}}" ─→ Editor
Pessimist ─┘
```

### How it works

1. Each inbound edge keeps its normal contract (condition, schema, transform, gate). The transform shapes that single upstream's contribution before it lands in a slot.
2. When an upstream's edge fires, the MergeCard stores its text in a slot keyed by the **upstream's display name** (case-insensitive).
3. The card waits until **every** direct-inbound upstream has filled its slot at least once. Then it renders its template, emits the result downstream, clears its slots, and re-arms.
4. If the timeout (default 60 seconds, configurable per card) elapses before all slots are filled, the card flips to **error** and stops. Slots are preserved for inspection. Click **Reset** on the card to clear and re-arm.

### Template grammar

| Placeholder | Resolves to |
|---|---|
| `{{slot.<Name>}}` | Full text in the slot (case-insensitive name lookup) |
| `{{slot.<Name>.field}}` | JSON dot-path into the slot's parsed output |

Unresolved placeholders (unknown slot, missing field, non-JSON output) are left intact.

### Compared to per-edge `{{nodes.<Name>.output}}`

Phase E added `{{nodes.<Name>.output}}` so an edge transform could reference *other* upstreams of its target. That syntax still works, but the connection editor's picker no longer surfaces it — use a MergeCard instead. The per-edge picker now lists fields from the immediate upstream only, which matches most users' mental model.
```

- [ ] **Step 2: Update the existing Transform expressions section**

In the `### Transform expressions` section that Phase E added, find this paragraph:

```markdown
**Discoverability**

In the canvas, right-click any connection → *Edit data contract*. The transform field has an **Insert from upstream** strip: pick an upstream node, then click any detected JSON field to insert the matching placeholder at the cursor.
```

Replace with:

```markdown
**Discoverability**

In the canvas, right-click any connection → *Edit data contract*. The transform field has an **Insert from upstream** strip showing the immediate upstream's available fields — click a chip to insert it at the cursor. For multi-input composition (pulling from sibling upstreams in one transform), use a [Merge Card](#merge-cards) instead.
```

- [ ] **Step 3: Commit**

```bash
git add docs/workflows.md
git commit -m "MergeCard: docs in workflows.md"
```

---

## Task 11: Manual smoke test

**No new files.**

- [ ] **Step 1: Start the dev stack**

```bash
cd /home/barrulus/dev/agentcanvas && ./run.sh
```

- [ ] **Step 2: Build the workflow**

1. On any dashboard, create three agents: `Optimist`, `Pessimist`, `Editor`. Use any provider/model that follows JSON instructions reliably (e.g. `gemma3:4b` already proven from Phase E smoke).
2. Optimist system prompt: `Reply ONLY with a JSON object: {"points": "<two short pros>"}. No prose, no fences.`
3. Pessimist system prompt: same shape with cons.
4. Click `+ Merge Card`. Edit it: name `Composer`, template:
   ```
   Pros from Optimist: {{slot.Optimist.points}}
   Cons from Pessimist: {{slot.Pessimist.points}}
   ```
   Timeout: 60.
5. Connect: `Optimist → Composer`, `Pessimist → Composer`, `Composer → Editor`.

- [ ] **Step 3: Happy path**

Send a question to both Optimist and Pessimist. Wait for both to complete. Watch the Composer card:
- After Optimist completes: status `waiting`, slots show `✓ optimist`, `· pessimist (waiting)`.
- After Pessimist completes: status `completed`, last-emission preview shows the rendered template, Editor receives it as input.

Open Editor's inspector → Input tab. Confirm the resolved prompt contains both `points` values pulled via `{{slot.X.points}}`.

- [ ] **Step 4: Timeout path**

1. Reset the Composer card.
2. Send a question only to Optimist.
3. Wait 60+ seconds. Composer should flip to `error` with `Timeout after 60s — missing: pessimist`. Editor should NOT receive any message.
4. Click Reset on the Composer card → status returns to `idle`.

- [ ] **Step 5: Picker simplification check**

Right-click the `Optimist → Composer` edge → *Edit data contract*. The "Insert from upstream" strip should show **only** Optimist's fields (`output` chip plus discovered JSON paths). No dropdown of sibling upstreams.

- [ ] **Step 6: Persistence check**

Restart the dev stack (`Ctrl+C` then `./run.sh` again). The Composer card should reappear on the canvas with its template intact.

- [ ] **Step 7: Commit nothing — manual gate**

If anything fails, file a defect against the offending task and re-execute.

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task. Backend model + storage (Task 1), manager (Task 2), template helper + routing wiring (Task 3), REST routes (Task 4), verification (Task 5), Redux + WS (Task 6), node component + registration (Task 7), Toolbar + dashboard hydration (Task 8), picker simplification (Task 9), docs (Task 10), smoke (Task 11).
- **Type consistency:** `MergeCard` shape identical between Pydantic (Task 1), TypeScript interface (Task 6), and component prop (Task 7). `expected_slots: list[str]` everywhere. `{{slot.<Name>[.field]}}` syntax used in Tasks 3, 5, 7, 10.
- **Cross-task references:** Task 2 imports `_resolve_card_name` and `_apply_template_with_slots` from `agent_manager.py`; both are defined in Task 3 — module-level imports inside Task 2's manager methods (function-scoped) avoid load-order issues.
- **No placeholders:** every code step shows the actual code; commands include expected outputs; Task 5's verification script covers all template branches plus the manager flow including timeout.
- **Test approach:** no test framework; verification is the script in Task 5 + Phase E's existing verifier (Task 3 step 7) as a back-compat regression gate + the manual smoke in Task 11.
- **Risk acknowledgements from spec:** `expected_slots` snapshot prevents mid-round topology changes (Task 1 model + Task 2 receive_input). Timer leak prevented by `_cancel_timer` in delete + emit + reset (Task 2). Cycle safety from existing `route_to_downstream` `visited` set (no change needed).
