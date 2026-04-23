// Thin localStorage wrapper for user preferences that are not server-persisted.
// Canvas preferences (zoom sensitivity, grid size) and keyboard shortcut bindings.

export interface CanvasPrefs {
  zoomSensitivity: number // multiplier on wheel deltaY; default 1.0
  gridSize: number        // pixels; default 24
}

export interface ShortcutBindings {
  newAgent: string
  settings: string
  history: string
  templates: string
  approveAll: string
  denyAll: string
}

export const DEFAULT_CANVAS_PREFS: CanvasPrefs = {
  zoomSensitivity: 1.0,
  gridSize: 24,
}

export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  newAgent: 'n',
  settings: 's',
  history: 'h',
  templates: 't',
  approveAll: 'Shift+A',
  denyAll: 'Shift+D',
}

const CANVAS_KEY = 'agentcanvas.canvasPrefs'
const SHORTCUTS_KEY = 'agentcanvas.shortcuts'

export function getCanvasPrefs(): CanvasPrefs {
  try {
    const raw = localStorage.getItem(CANVAS_KEY)
    if (!raw) return { ...DEFAULT_CANVAS_PREFS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_CANVAS_PREFS, ...parsed }
  } catch {
    return { ...DEFAULT_CANVAS_PREFS }
  }
}

export function setCanvasPrefs(prefs: CanvasPrefs) {
  localStorage.setItem(CANVAS_KEY, JSON.stringify(prefs))
  window.dispatchEvent(new CustomEvent('agentcanvas:prefs-changed'))
}

export function getShortcuts(): ShortcutBindings {
  try {
    const raw = localStorage.getItem(SHORTCUTS_KEY)
    if (!raw) return { ...DEFAULT_SHORTCUTS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SHORTCUTS, ...parsed }
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
}

export function setShortcuts(shortcuts: ShortcutBindings) {
  localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts))
  window.dispatchEvent(new CustomEvent('agentcanvas:prefs-changed'))
}

// Parse a binding like "Shift+A" or "n" into its parts
export function parseBinding(binding: string): { key: string; shift: boolean; ctrl: boolean; meta: boolean; alt: boolean } {
  const parts = binding.split('+').map(p => p.trim())
  const key = parts[parts.length - 1]
  return {
    key,
    shift: parts.includes('Shift'),
    ctrl: parts.includes('Ctrl'),
    meta: parts.includes('Meta') || parts.includes('Cmd'),
    alt: parts.includes('Alt'),
  }
}

export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  const b = parseBinding(binding)
  if (b.shift !== e.shiftKey) return false
  if (b.ctrl !== e.ctrlKey) return false
  if (b.meta !== e.metaKey) return false
  if (b.alt !== e.altKey) return false
  // For single-char bindings, case-insensitive compare of the key name
  return e.key === b.key || e.key.toLowerCase() === b.key.toLowerCase()
}
