import { useState } from 'react'
import { Canvas } from './pages/Canvas/Canvas'
import { Toolbar } from './pages/Canvas/Toolbar'
import { Settings } from './pages/Settings/Settings'

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar onOpenSettings={() => setShowSettings(true)} />
      <Canvas />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  )
}
