import { Canvas } from './pages/Canvas/Canvas'
import { Toolbar } from './pages/Canvas/Toolbar'

export function App() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar />
      <Canvas />
    </div>
  )
}
