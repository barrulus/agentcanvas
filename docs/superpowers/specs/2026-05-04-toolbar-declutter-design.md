# Toolbar declutter — design

Replace two cluttered horizontal clusters in the canvas toolbar with collapsed dropdown buttons:
- **Left:** dashboard tabs → folder-style dropdown picker (hierarchy-ready)
- **Right:** six `+ X Card` buttons → single `+ Add ▾` menu (icon-ready)

The middle cluster (Constraints / T / clock / cog) stays as-is.

## Goals

- Reduce horizontal toolbar real estate to two buttons (left + right) regardless of how many dashboards or card types exist.
- Make the dashboard picker structurally ready for future folder/hierarchy support without rewriting the component.
- Make the card-creation menu structurally ready for icons without rewriting items.
- Preserve every existing capability: switch / rename / delete dashboards; create every card type with its current dialog flow where applicable.

## Non-goals

- No hierarchy data model in this round. Today's flat `Dashboard[]` list keeps working; the picker just renders the tree-component-with-one-level.
- No real icons in this round. The icon slot is a placeholder dot.
- No keyboard shortcut overhaul (Cmd-K palette, Tab cycling, etc.). The two new menus are mouse-driven; existing keybindings unaffected.
- No move of `Constraints`, `T` (templates), clock (history?), cog (settings) — they stay as separate icon buttons in the middle cluster.

## Left — dashboard picker

### Trigger button

```
[ ▾ <currentDashboardName> ]
```

Single outlined button. Width sized to current name (min ~120px, max ~280px with ellipsis). Clicking opens a popdown panel anchored below it.

If `currentDashboardId` doesn't resolve, show `▾ Pick dashboard`.

### Panel contents

```
┌──────────────────────────────┐
│  Default                     │
│  Level One                   │
│  Companies                   │
│  Affecti                     │
│ ✓ Smoke                      │ ← active row: checkmark + accent bg
│ ──────────────────────────── │
│  + New dashboard             │
└──────────────────────────────┘
```

- One row per dashboard.
- Active dashboard: leading `✓` glyph + accent background (cyan tint, matching existing accent token used elsewhere). Both indicators per the user decision.
- Click a row → `handleSwitchDashboard(id)` (already implemented), close panel.
- **Right-click a row** → opens the existing rename/delete context menu (`dashCtxMenu`). Move the listener from the old tab strip to each row in the panel.
- Footer separator + `+ New dashboard` row → reuses `handleNewDashboard()` (existing). Closes panel after the new dashboard is created and switched to.

### Panel behavior

- Click outside → close (use the same outside-click pattern the existing `dashCtxMenu` uses).
- Esc → close.
- Tab/arrow-key navigation: not in scope for v1.
- Max-height with scroll if dashboards > ~12.

### Hierarchy readiness

The panel renders from a `DashboardNode[]`:

```ts
type DashboardNode = {
  id: string
  name: string
  children?: DashboardNode[]   // empty / undefined today
}
```

Today: pass `dashboards.map(d => ({ id: d.id, name: d.name }))` — flat list. When folder support arrives, the same component renders nested children with a chevron, expand/collapse on click. **No need to add `parent_id` to `Dashboard` now** — just keep the component recursion-capable.

The recursive renderer handles depth via left-padding (`paddingLeft: depth * 12`). Empty `children` arrays render exactly as today.

## Right — `+ Add ▾` menu

### Trigger button

```
[ + Add ▾ ]
```

Filled accent button (mirrors today's `+ New Agent` styling — it's the primary creation action).

### Panel contents

```
┌──────────────────────────┐
│  ◯ Agent…                │
│  ◯ Input Card            │
│  ◯ View Card             │
│  ◯ Gate Card…            │
│  ◯ Dialogue Card         │
│  ◯ Merge Card            │
└──────────────────────────┘
```

- One row per card type. Order: Agent, Input, View, Gate, Dialogue, Merge (most-used first; Agent stays at top).
- `…` suffix on labels whose creation opens a dialog (Agent, Gate today). Convention: indicates "opens a dialog" rather than instant create.
- Each row has a leading `icon?: ReactNode` slot. Today rendered as `◯` (a placeholder dot). Future-real-icon swap is a one-line edit per row.

### Item shape

```ts
type AddCardItem = {
  key: 'agent' | 'input' | 'view' | 'gate' | 'dialogue' | 'merge'
  label: string                    // "Agent", "Input Card", ...
  hasDialog: boolean               // controls "…" suffix
  icon?: ReactNode                 // placeholder ◯ today
  onClick: () => void              // existing handler (createInputCard, setShowDialog(true), etc.)
}
```

### Panel behavior

Same close rules as the dashboard picker: outside-click, Esc, action-click all close.

## Implementation outline

### Files to modify

| File | Change |
|---|---|
| `frontend/src/app/pages/Canvas/Toolbar.tsx` | Remove tab strip JSX (lines ~290-330) and the six `+ X Card` button JSX (lines ~510-580); add two new dropdown button blocks |
| `frontend/src/app/pages/Canvas/DashboardPicker.tsx` | New — dashboard picker component |
| `frontend/src/app/pages/Canvas/AddCardMenu.tsx` | New — add-card menu component |

Both new components are presentational only — they take props (data + handlers) and emit clicks. State (`dashboards`, `currentDashboardId`, the create handlers) stays in `Toolbar.tsx`.

### Reused existing code

- `handleSwitchDashboard`, `handleNewDashboard`, `handleRenameDashboard`, `handleDeleteDashboard`, `dashCtxMenu`, the close-on-outside-click `useEffect` for `dashCtxMenu` — keep all unchanged. The picker rows attach the right-click handler that sets `dashCtxMenu`.
- All six card creation handlers (`handleCreateInputCard`, `handleCreateViewCard`, `setShowGateDialog`, the dialogue create inline handler, the merge create inline handler, `setShowDialog` for the agent dialog) — wire each to the corresponding `AddCardItem.onClick`.
- The Gate Card and Agent Card dialogs (`showGateDialog`, `showDialog`) keep their existing JSX. Only their *trigger* moves from a button into a menu item.

### State (new, both in `Toolbar.tsx`)

```ts
const [showDashboardPicker, setShowDashboardPicker] = useState(false)
const [showAddMenu, setShowAddMenu] = useState(false)
```

Outside-click handlers mirror the existing `dashCtxMenu` pattern.

### Component contracts

```tsx
<DashboardPicker
  dashboards={dashboards}                   // future: DashboardNode[]; today: flat
  currentId={currentDashboardId}
  onSwitch={(id) => { handleSwitchDashboard(id); setShowDashboardPicker(false) }}
  onNew={async () => { await handleNewDashboard(); setShowDashboardPicker(false) }}
  onRowContextMenu={(id, x, y) => setDashCtxMenu({ id, x, y })}
  open={showDashboardPicker}
  onClose={() => setShowDashboardPicker(false)}
/>

<AddCardMenu
  items={addItems}                          // built in Toolbar.tsx from existing handlers
  open={showAddMenu}
  onClose={() => setShowAddMenu(false)}
/>
```

## Visual / styling notes

- Both buttons match the existing toolbar height (~32px). Padding `6px 12px` to match the current `+ Card` button cluster.
- Panels: `position: absolute`, `top: 100%`, drop-shadow, same dark surface as existing modals (`#1a1a2e`), 1px border (`#333`), 12px border-radius. Min-width matches the trigger button.
- Active row in dashboard picker: `background: #1f3a5a`, `color: #9fd9ff` (existing accent palette). Checkmark uses the same color.
- Hover row: `background: #1a1a2e22`.
- Disabled state: not needed (every action is always available).

## Migration / regression watch

- The existing tab strip's `+` button (creates a new dashboard) goes away — its function moves into the picker's footer. Keep the keyboard accessibility equivalent (clicking the picker, then the `+ New dashboard` row).
- The right-click context menu's positioning logic (`{ x: e.clientX, y: e.clientY }`) — keep absolute viewport coordinates since the menu still renders at fixed position.
- E2E flows that currently rely on a specific tab being clickable would need to update if there were any; since this is a UI demo project with no E2E suite, no migration testing required.

## Out of scope (deferred)

- **Folder hierarchy data model.** When you want it, add `parent_id?: string` to `Dashboard` and a small `DashboardFolder` type or just reuse `Dashboard` with a `kind: 'folder'|'dashboard'` discriminator. The picker component supports this with no API change — only the data builder in `Toolbar.tsx` needs to assemble the tree.
- **Real icons.** When you want them, replace the `◯` placeholder per item — one line each in `AddCardMenu`'s item list.
- **Keyboard navigation in panels** (arrow keys, type-ahead).
- **Drag-and-drop reorder of dashboards.**
- **Search/filter** in the dashboard picker (only useful when you have many dashboards or folder hierarchy).

## Risks

- **Outside-click handlers stack:** with both panels potentially open, two outside-click `useEffect`s coexist. They should both attach `mousedown` listeners that ignore clicks inside their own panel. Mirror the existing `dashCtxMenu` cleanup exactly.
- **Mobile / narrow viewports:** AgentCanvas is desktop-only today; no change. If anyone resizes < 600px wide, the panels will still render but may overflow. Acceptable.
- **Discoverability regression:** new users won't immediately see all card types behind `+ Add ▾` — they have to click. Mitigated by labeling the button "Add" rather than just `+`. The dashboard picker has the same tradeoff and is a standard pattern users recognize.

## Build sequence

1. `DashboardPicker.tsx` (presentational), wire into `Toolbar.tsx`, remove tab strip.
2. `AddCardMenu.tsx` (presentational), wire into `Toolbar.tsx`, remove six `+ X Card` buttons.
3. Manual smoke: switch / create / rename / delete dashboards via picker; create one of each card type via menu (agent + gate dialogs still open correctly).

Plan to follow.
