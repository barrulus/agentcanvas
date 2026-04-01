import { useState } from 'react'
import { Canvas } from './pages/Canvas/Canvas'
import { Toolbar } from './pages/Canvas/Toolbar'
import { Settings } from './pages/Settings/Settings'
import { History } from './pages/History/History'

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
      />
      <Canvas />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showHistory && <History onClose={() => setShowHistory(false)} />}
    </div>
  )
}
