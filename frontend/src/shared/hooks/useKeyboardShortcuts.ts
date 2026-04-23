import { useEffect, useCallback, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '../state/store'
import { clearApprovalRequest } from '../state/agentsSlice'
import { bringToFront } from '../state/canvasSlice'
import { wsManager } from '../ws/WebSocketManager'
import { getShortcuts, matchesBinding } from '../prefs'

interface ShortcutCallbacks {
  onToggleNewAgent: () => void
  onToggleSettings: () => void
  onToggleHistory: () => void
  onToggleTemplates: () => void
}

export function useKeyboardShortcuts(callbacks: ShortcutCallbacks) {
  const dispatch = useDispatch<AppDispatch>()
  const sessions = useSelector((s: RootState) => s.agents.sessions)
  const cards = useSelector((s: RootState) => s.canvas.cards)
  const [bindings, setBindings] = useState(getShortcuts())

  useEffect(() => {
    const onChange = () => setBindings(getShortcuts())
    window.addEventListener('agentcanvas:prefs-changed', onChange)
    return () => window.removeEventListener('agentcanvas:prefs-changed', onChange)
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    if (target.isContentEditable) return

    if (matchesBinding(e, bindings.approveAll)) {
      e.preventDefault()
      for (const s of Object.values(sessions)) {
        if (s.pendingApproval) {
          wsManager.sendApprovalResponse(s.pendingApproval.approvalId, true)
          dispatch(clearApprovalRequest(s.id))
        }
      }
      return
    }

    if (matchesBinding(e, bindings.denyAll)) {
      e.preventDefault()
      for (const s of Object.values(sessions)) {
        if (s.pendingApproval) {
          wsManager.sendApprovalResponse(s.pendingApproval.approvalId, false)
          dispatch(clearApprovalRequest(s.id))
        }
      }
      return
    }

    // Skip remaining if any modifier held
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return

    // 1-9: focus agent by position
    const digit = parseInt(e.key)
    if (digit >= 1 && digit <= 9) {
      const cardList = Object.values(cards).sort((a, b) => a.x - b.x || a.y - b.y)
      const card = cardList[digit - 1]
      if (card) {
        dispatch(bringToFront(card.session_id))
      }
      return
    }

    if (matchesBinding(e, bindings.newAgent)) { e.preventDefault(); callbacks.onToggleNewAgent(); return }
    if (matchesBinding(e, bindings.settings)) { e.preventDefault(); callbacks.onToggleSettings(); return }
    if (matchesBinding(e, bindings.history)) { e.preventDefault(); callbacks.onToggleHistory(); return }
    if (matchesBinding(e, bindings.templates)) { e.preventDefault(); callbacks.onToggleTemplates(); return }
  }, [sessions, cards, dispatch, callbacks, bindings])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
