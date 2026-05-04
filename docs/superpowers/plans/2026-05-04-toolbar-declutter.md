# Toolbar declutter — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard tab strip with a folder-style dropdown picker, and replace the six `+ X Card` buttons with a single `+ Add ▾` menu, in `frontend/src/app/pages/Canvas/Toolbar.tsx`.

**Architecture:** Two new presentational components (`DashboardPicker.tsx`, `AddCardMenu.tsx`) wired into `Toolbar.tsx`. State stays in `Toolbar`; new components take props. Both panels match the existing context-menu close-on-outside-click pattern. No backend changes. The Input Card's existing chat/webhook/file submenu flattens into three top-level rows in the Add menu.

**Tech Stack:** React 19 + TypeScript + Redux Toolkit + Vite. Existing dark-theme styling (`#1a1a2e` surface, `#4fc3f7` accent).

**Spec:** `docs/superpowers/specs/2026-05-04-toolbar-declutter-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `frontend/src/app/pages/Canvas/DashboardPicker.tsx` | Create | Presentational dropdown: trigger button + panel rendering a `DashboardNode[]` (recursive); emits switch / new / context-menu callbacks. |
| `frontend/src/app/pages/Canvas/AddCardMenu.tsx` | Create | Presentational dropdown: trigger button + panel of `AddCardItem[]` rows with placeholder icon slots. |
| `frontend/src/app/pages/Canvas/Toolbar.tsx` | Modify | Remove tab strip JSX (~lines 292-340) and the six card-creation button blocks (~lines 471-614). Add the two new components, build their data props from existing state/handlers. Add open/close state for both panels. |

---

## Task 1: `DashboardPicker` component

**Files:**
- Create: `frontend/src/app/pages/Canvas/DashboardPicker.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useRef } from 'react'

export type DashboardNode = {
  id: string
  name: string
  children?: DashboardNode[]
}

export function DashboardPicker({
  nodes,
  currentId,
  open,
  onToggle,
  onClose,
  onSwitch,
  onNew,
  onRowContextMenu,
}: {
  nodes: DashboardNode[]
  currentId: string
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSwitch: (id: string) => void
  onNew: () => void
  onRowContextMenu: (id: string, x: number, y: number) => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const currentName = findName(nodes, currentId) || 'Pick dashboard'

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        onClick={onToggle}
        style={{
          padding: '6px 12px',
          background: 'transparent',
          color: '#e0e0e0',
          border: '1px solid #333',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 120,
          maxWidth: 280,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title="Switch dashboard"
      >
        <span style={{ color: '#888', fontSize: 10 }}>▾</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentName}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#1a1a2e',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 4,
            zIndex: 10000,
            minWidth: 220,
            maxHeight: 480,
            overflowY: 'auto',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          {nodes.map((node) => (
            <DashboardRow
              key={node.id}
              node={node}
              depth={0}
              currentId={currentId}
              onSwitch={onSwitch}
              onRowContextMenu={onRowContextMenu}
            />
          ))}
          <div style={{ height: 1, background: '#333', margin: '4px 0' }} />
          <button
            onClick={onNew}
            style={{
              ...rowBaseStyle,
              color: '#9fd9ff',
            }}
          >
            + New dashboard
          </button>
        </div>
      )}
    </div>
  )
}

function DashboardRow({
  node,
  depth,
  currentId,
  onSwitch,
  onRowContextMenu,
}: {
  node: DashboardNode
  depth: number
  currentId: string
  onSwitch: (id: string) => void
  onRowContextMenu: (id: string, x: number, y: number) => void
}) {
  const isActive = node.id === currentId
  return (
    <>
      <button
        onClick={() => onSwitch(node.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onRowContextMenu(node.id, e.clientX, e.clientY)
        }}
        style={{
          ...rowBaseStyle,
          paddingLeft: 8 + depth * 12,
          background: isActive ? '#1f3a5a' : 'transparent',
          color: isActive ? '#9fd9ff' : '#e0e0e0',
          fontWeight: isActive ? 600 : 400,
        }}
        title="Right-click for rename / delete"
      >
        <span style={{ width: 12, display: 'inline-block', color: isActive ? '#9fd9ff' : 'transparent' }}>✓</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
      </button>
      {node.children?.map((child) => (
        <DashboardRow
          key={child.id}
          node={child}
          depth={depth + 1}
          currentId={currentId}
          onSwitch={onSwitch}
          onRowContextMenu={onRowContextMenu}
        />
      ))}
    </>
  )
}

function findName(nodes: DashboardNode[], id: string): string | null {
  for (const n of nodes) {
    if (n.id === id) return n.name
    if (n.children) {
      const child = findName(n.children, id)
      if (child) return child
    }
  }
  return null
}

const rowBaseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '6px 8px',
  background: 'transparent',
  color: '#e0e0e0',
  border: 'none',
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}
```

- [ ] **Step 2: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npx tsc --noEmit 2>&1 | tail -5
```

Expected: no errors related to `DashboardPicker.tsx`.

- [ ] **Step 3: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add frontend/src/app/pages/Canvas/DashboardPicker.tsx
git -C /home/barrulus/dev/agentcanvas commit -m "Toolbar: DashboardPicker component (folder-ready dropdown)"
```

NO `Co-Authored-By` line.

---

## Task 2: `AddCardMenu` component

**Files:**
- Create: `frontend/src/app/pages/Canvas/AddCardMenu.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useRef, type ReactNode } from 'react'

export type AddCardItem = {
  key: string
  label: string
  hasDialog?: boolean
  icon?: ReactNode
  onSelect: () => void
}

export function AddCardMenu({
  items,
  open,
  onToggle,
  onClose,
}: {
  items: AddCardItem[]
  open: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        onClick={onToggle}
        style={{
          padding: '6px 16px',
          background: '#4fc3f7',
          color: '#000',
          border: 'none',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
        title="Add a card to the canvas"
      >
        <span>+ Add</span>
        <span style={{ color: '#003a52', fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: '#1a1a2e',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 4,
            zIndex: 10000,
            minWidth: 200,
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              onClick={() => { it.onSelect(); onClose() }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 8px',
                background: 'transparent',
                color: '#e0e0e0',
                border: 'none',
                borderRadius: 4,
                fontSize: 12,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ width: 14, color: '#666', textAlign: 'center' }}>
                {it.icon ?? '◯'}
              </span>
              <span>{it.label}{it.hasDialog ? '…' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npx tsc --noEmit 2>&1 | tail -5
```

Expected: no errors related to `AddCardMenu.tsx`.

- [ ] **Step 3: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add frontend/src/app/pages/Canvas/AddCardMenu.tsx
git -C /home/barrulus/dev/agentcanvas commit -m "Toolbar: AddCardMenu component (icon-ready dropdown)"
```

NO `Co-Authored-By` line.

---

## Task 3: Wire both into `Toolbar.tsx`, remove old buttons

**Files:**
- Modify: `frontend/src/app/pages/Canvas/Toolbar.tsx`

This task replaces two cluttered horizontal blocks with one button each. **Read the file first** — line numbers below are approximate; identify the actual blocks before editing.

- [ ] **Step 1: Add imports**

Near the existing local-component imports at the top of `Toolbar.tsx`, add:

```tsx
import { DashboardPicker, type DashboardNode } from './DashboardPicker'
import { AddCardMenu, type AddCardItem } from './AddCardMenu'
```

- [ ] **Step 2: Add open/close state for both panels**

After the existing `dashCtxMenu` `useState` (around line 241), add:

```tsx
const [showDashboardPicker, setShowDashboardPicker] = useState(false)
const [showAddMenu, setShowAddMenu] = useState(false)
```

- [ ] **Step 3: Build the dashboard tree (flat today)**

Just before the `return (`, compute:

```tsx
const dashboardTree: DashboardNode[] = dashboards.map((d) => ({ id: d.id, name: d.name }))
```

This is the ONE place where, when folder support arrives, you'll assemble children from `parent_id`. The component itself doesn't change.

- [ ] **Step 4: Build the AddCardItem list**

Also just before `return (`, build:

```tsx
const addItems: AddCardItem[] = [
  { key: 'agent',         label: 'Agent',         hasDialog: true,  onSelect: () => setShowDialog(true) },
  { key: 'input-chat',    label: 'Chat Input',                     onSelect: () => handleCreateInputCard('chat') },
  { key: 'input-webhook', label: 'Webhook Input',                  onSelect: () => handleCreateInputCard('webhook') },
  { key: 'input-file',    label: 'File Watcher Input',             onSelect: () => handleCreateInputCard('file') },
  { key: 'view',          label: 'View Card',                      onSelect: () => handleCreateViewCard() },
  { key: 'gate',          label: 'Gate Card',     hasDialog: true,  onSelect: () => setShowGateDialog(true) },
  { key: 'dialogue',      label: 'Dialogue Card',                  onSelect: async () => {
      const result = await dispatch(createDialogueCard({
        name: 'Dialogue', participants: [], max_turns: 20, output_mode: 'last_message',
        dashboard_id: currentDashboardId,
      })).unwrap()
      dispatch(placeCard({ sessionId: result.id, card_type: 'dialogue' }))
    } },
  { key: 'merge',         label: 'Merge Card',                     onSelect: async () => {
      const result = await dispatch(createMergeCard({
        name: 'Merge', template: '', timeout_seconds: 60,
        dashboard_id: currentDashboardId,
      })).unwrap()
      dispatch(placeCard({ sessionId: result.id, card_type: 'merge' }))
    } },
]
```

Note the input card's old single-button-with-submenu is now flattened into three top-level rows: `Chat Input`, `Webhook Input`, `File Watcher Input`. This matches the spec's flat-list pattern.

- [ ] **Step 5: Replace the dashboard tab strip**

Find the existing tab strip block (around lines 292-340 — starts with `{/* Dashboard tabs */}` and the `<div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 12 }}>` opening, ends after the `+` button at line 339). DELETE the entire block.

In its place, insert:

```tsx
      {/* Dashboard picker */}
      <div style={{ marginLeft: 12 }}>
        <DashboardPicker
          nodes={dashboardTree}
          currentId={currentDashboardId}
          open={showDashboardPicker}
          onToggle={() => setShowDashboardPicker((v) => !v)}
          onClose={() => setShowDashboardPicker(false)}
          onSwitch={(id) => { handleSwitchDashboard(id); setShowDashboardPicker(false) }}
          onNew={async () => { await handleNewDashboard(); setShowDashboardPicker(false) }}
          onRowContextMenu={(id, x, y) => setDashCtxMenu({ id, x, y })}
        />
      </div>
```

- [ ] **Step 6: Replace the six card-creation button blocks**

Find each of the following blocks and DELETE all of them:

1. The Input Card block including its `showInputMenu` submenu (around lines 471-513)
2. The View Card button (around lines 515-530)
3. The Gate Card button (around lines 532-547)
4. The Dialogue Card button (around lines 549-573)
5. The Merge Card button (around lines 575-598)
6. The `+ New Agent` button (around lines 600-615)

Insert in their place ONE block:

```tsx
      <AddCardMenu
        items={addItems}
        open={showAddMenu}
        onToggle={() => setShowAddMenu((v) => !v)}
        onClose={() => setShowAddMenu(false)}
      />
```

- [ ] **Step 7: Remove now-unused state**

The `showInputMenu` state and any `inputMenuItemStyle` constant that's no longer referenced should be removed. Search:

```bash
grep -n "showInputMenu\|setShowInputMenu\|inputMenuItemStyle" frontend/src/app/pages/Canvas/Toolbar.tsx
```

Delete the lines that declare them. The agent dialog's `showDialog` state and the gate dialog's `showGateDialog` state STAY — they're still triggered, just from menu items now.

- [ ] **Step 8: Build check**

```bash
cd /home/barrulus/dev/agentcanvas/frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds. If TypeScript complains about unused imports, remove them.

- [ ] **Step 9: Commit**

```bash
git -C /home/barrulus/dev/agentcanvas add frontend/src/app/pages/Canvas/Toolbar.tsx
git -C /home/barrulus/dev/agentcanvas commit -m "Toolbar: collapse tabs into picker and 6 card buttons into Add menu"
```

NO `Co-Authored-By` line.

---

## Task 4: Manual smoke test

- [ ] **Step 1: Start the dev stack**

```bash
cd /home/barrulus/dev/agentcanvas && ./run.sh
```

- [ ] **Step 2: Dashboard picker — switch / new / rename / delete**

1. Click the dashboard picker (left button, e.g. `▾ Smoke`). Panel opens.
2. Active dashboard has `✓` and accent background.
3. Click another dashboard → panel closes, canvas switches.
4. Re-open picker → click `+ New dashboard` → prompt appears → enter a name → new dashboard becomes active.
5. Re-open picker → right-click a dashboard row → existing rename/delete context menu appears → both actions still work.
6. Press Esc with picker open → panel closes.
7. Click outside picker while open → panel closes.

- [ ] **Step 3: Add menu — every card type creates correctly**

1. Click `+ Add ▾` (right button). Panel opens.
2. Each item shows `◯` placeholder icon + label, dialog items have `…` suffix.
3. Click `Agent…` → existing agent-creation dialog opens. Cancel.
4. Click `Chat Input` → input card placed on canvas with `chat` source type.
5. Click `Webhook Input` → input card placed with `webhook` source type.
6. Click `File Watcher Input` → input card placed with `file` source type.
7. Click `View Card` → view card placed.
8. Click `Gate Card…` → existing gate-creation dialog opens. Cancel.
9. Click `Dialogue Card` → dialogue card placed.
10. Click `Merge Card` → merge card placed.

- [ ] **Step 4: Outside-click + Esc work for both**

Confirmed in steps 2 and 3.

- [ ] **Step 5: No regressions in middle cluster**

`Constraints`, `T` (templates), clock (history), cog (settings) buttons all still render and open their existing UIs.

- [ ] **Step 6: Commit nothing — manual gate**

If anything fails, file a defect against the offending task and re-execute.

---

## Self-Review Notes

- **Spec coverage:** Dashboard picker (Task 1) covers single-button trigger, recursive panel rendering, active highlight, `+ New dashboard` footer, right-click context menu hookup, outside-click + Esc close. Add menu (Task 2) covers single-button trigger, item list with icon slot + dialog suffix, outside-click + Esc close. Toolbar wiring (Task 3) removes old JSX and connects everything to existing handlers. Smoke (Task 4) exercises every flow.
- **No placeholders:** every code step has the actual content. The `inputMenuItemStyle` cleanup is explicitly searched for.
- **Type consistency:** `DashboardNode` shape used in component and in the `dashboardTree` builder. `AddCardItem` shape used in component and in `addItems` builder. Both export their types so `Toolbar.tsx` imports them.
- **Hierarchy / icon readiness:** confirmed in component design — `DashboardNode.children` recurses, `AddCardItem.icon` slot accepts any ReactNode. Today's data passes empty children / placeholder dots.
- **What stays unchanged:** `dashCtxMenu` state and the existing rename/delete handlers, the agent + gate dialogs, the middle cluster (Constraints/T/clock/cog), the dashboard load-on-switch logic.
