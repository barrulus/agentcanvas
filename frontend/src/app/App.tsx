import { useState, useCallback, useEffect } from 'react'
import '@xyflow/react/dist/style.css'
import './pages/Canvas/xyflow/xyflow.css'
import { Canvas } from './pages/Canvas/Canvas'
import { Toolbar } from './pages/Canvas/Toolbar'
import { Settings } from './pages/Settings/Settings'
import { History } from './pages/History/History'
import { RunsDrawer } from './pages/Canvas/RunsDrawer'
import { Templates } from './pages/Templates/Templates'
import { PromptTemplate } from '@/shared/state/templatesSlice'
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts'
import { getCanvasPrefs } from '@/shared/prefs'

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<PromptTemplate | null>(null)

  // Quick dark->light: invert + hue-rotate the whole document. Re-applied on pref changes.
  // Images, videos, and canvas elements are counter-inverted so media renders correctly.
  useEffect(() => {
    const STYLE_ID = 'agentcanvas-light-mode-style'
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style')
      s.id = STYLE_ID
      s.textContent = `
        html[data-theme="light"] img,
        html[data-theme="light"] video,
        html[data-theme="light"] canvas,
        html[data-theme="light"] svg image,
        html[data-theme="light"] [data-no-invert] {
          filter: invert(1) hue-rotate(180deg);
        }
      `
      document.head.appendChild(s)
    }
    const apply = () => {
      const light = getCanvasPrefs().lightMode
      document.documentElement.style.filter = light ? 'invert(1) hue-rotate(180deg)' : ''
      document.documentElement.dataset.theme = light ? 'light' : 'dark'
    }
    apply()
    window.addEventListener('agentcanvas:prefs-changed', apply)
    return () => window.removeEventListener('agentcanvas:prefs-changed', apply)
  }, [])

  useKeyboardShortcuts({
    onToggleNewAgent: useCallback(() => setShowNewAgent(v => !v), []),
    onToggleSettings: useCallback(() => setShowSettings(v => !v), []),
    onToggleHistory: useCallback(() => setShowHistory(v => !v), []),
    onToggleTemplates: useCallback(() => setShowTemplates(v => !v), []),
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
        onOpenRuns={() => setShowRuns(true)}
        onOpenTemplates={() => setShowTemplates(true)}
        showDialog={showNewAgent}
        setShowDialog={setShowNewAgent}
        initialTemplate={pendingTemplate}
        onTemplateClear={() => setPendingTemplate(null)}
      />
      <Canvas />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showHistory && <History onClose={() => setShowHistory(false)} />}
      {showRuns && <RunsDrawer onClose={() => setShowRuns(false)} />}
      {showTemplates && <Templates onClose={() => setShowTemplates(false)} onUseTemplate={(t) => {
        setPendingTemplate(t)
        setShowTemplates(false)
        setShowNewAgent(true)
      }} />}
    </div>
  )
}
