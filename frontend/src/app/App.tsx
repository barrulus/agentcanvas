import { useState, useCallback } from 'react'
import { Canvas } from './pages/Canvas/Canvas'
import { Toolbar } from './pages/Canvas/Toolbar'
import { Settings } from './pages/Settings/Settings'
import { History } from './pages/History/History'
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts'

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showNewAgent, setShowNewAgent] = useState(false)

  useKeyboardShortcuts({
    onToggleNewAgent: useCallback(() => setShowNewAgent(v => !v), []),
    onToggleSettings: useCallback(() => setShowSettings(v => !v), []),
    onToggleHistory: useCallback(() => setShowHistory(v => !v), []),
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
        showDialog={showNewAgent}
        setShowDialog={setShowNewAgent}
      />
      <Canvas />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showHistory && <History onClose={() => setShowHistory(false)} />}
    </div>
  )
}
