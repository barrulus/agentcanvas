import { useRef, useState, useCallback, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { RootState } from '@/shared/state/store'
import { AgentCard } from './AgentCard'
import { debouncedSaveLayout } from '@/shared/state/canvasSlice'

export function Canvas() {
  const cards = useSelector((s: RootState) => s.canvas.cards)
  const connections = useSelector((s: RootState) => s.canvas.connections)
  const contentRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (Object.keys(cards).length > 0) {
      debouncedSaveLayout(cards)
    }
  }, [cards])

  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [zoom, setZoom] = useState(1)
  const isPanning = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  const clampZoom = (z: number) => Math.min(3, Math.max(0.15, z))

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.altKey) {
      // Alt+scroll to zoom
      e.preventDefault()
      const delta = -e.deltaY * 0.01
      setZoom(z => clampZoom(z * (1 + delta)))
    } else {
      // Scroll to pan
      setPanX(x => x - e.deltaX)
      setPanY(y => y - e.deltaY)
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.target === viewportRef.current)) {
      isPanning.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
      e.preventDefault()
    }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      setPanX(x => x + dx)
      setPanY(y => y + dy)
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    isPanning.current = false
  }, [])

  return (
    <div
      ref={viewportRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
        cursor: isPanning.current ? 'grabbing' : 'default',
        background: '#0a0a0f',
      }}
    >
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)`,
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${panX % (24 * zoom)}px ${panY % (24 * zoom)}px`,
        pointerEvents: 'none',
      }} />

      <div
        ref={contentRef}
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        {Object.values(cards).map(card => (
          <AgentCard key={card.session_id} card={card} />
        ))}

        {/* Connection lines — rendered AFTER cards so they appear on top */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, pointerEvents: 'none', overflow: 'visible', zIndex: 999999 }}>
          {connections.map((conn, i) => {
            const from = cards[conn.from]
            const to = cards[conn.to]
            if (!from || !to) return null

            // Card centers
            const fcx = from.x + from.width / 2
            const fcy = from.y + from.height / 2
            const tcx = to.x + to.width / 2
            const tcy = to.y + to.height / 2

            // Direction vector between centers
            const dx = tcx - fcx
            const dy = tcy - fcy

            // Pick best edge pair based on dominant direction
            // Each port: { x, y, nx, ny } where nx,ny is the outward normal
            type Port = { x: number; y: number; nx: number; ny: number }

            const fromPorts: Port[] = [
              { x: from.x + from.width, y: fcy, nx: 1, ny: 0 },  // right
              { x: from.x, y: fcy, nx: -1, ny: 0 },               // left
              { x: fcx, y: from.y + from.height, nx: 0, ny: 1 },  // bottom
              { x: fcx, y: from.y, nx: 0, ny: -1 },               // top
            ]
            const toPorts: Port[] = [
              { x: to.x, y: tcy, nx: -1, ny: 0 },                 // left
              { x: to.x + to.width, y: tcy, nx: 1, ny: 0 },       // right
              { x: tcx, y: to.y, nx: 0, ny: -1 },                 // top
              { x: tcx, y: to.y + to.height, nx: 0, ny: 1 },      // bottom
            ]

            // Score each pair: prefer ports that face each other and are close
            let bestScore = -Infinity
            let fp = fromPorts[0], tp = toPorts[0]
            for (const f of fromPorts) {
              for (const t of toPorts) {
                const ex = t.x - f.x
                const ey = t.y - f.y
                const dist = Math.sqrt(ex * ex + ey * ey) || 1
                // Dot product: source normal should point toward target
                const srcAlign = (f.nx * ex + f.ny * ey) / dist
                // Dot product: target normal should point toward source
                const tgtAlign = -(t.nx * ex + t.ny * ey) / dist
                // Penalise very short distances (ports on same edge)
                const score = srcAlign + tgtAlign - dist * 0.001
                if (score > bestScore) {
                  bestScore = score
                  fp = f; tp = t
                }
              }
            }

            // Control points: extend outward from each port along its normal
            const cpDist = Math.max(60, Math.sqrt((tp.x - fp.x) ** 2 + (tp.y - fp.y) ** 2) * 0.4)
            const cp1x = fp.x + fp.nx * cpDist
            const cp1y = fp.y + fp.ny * cpDist
            const cp2x = tp.x + tp.nx * cpDist
            const cp2y = tp.y + tp.ny * cpDist

            const pathD = `M ${fp.x} ${fp.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tp.x} ${tp.y}`

            // Arrowhead from bezier tangent at t=1: 3*(P3 - CP2)
            const tx = tp.x - cp2x
            const ty = tp.y - cp2y
            const tlen = Math.sqrt(tx * tx + ty * ty) || 1
            const nx = tx / tlen
            const ny = ty / tlen
            const aSize = 14, aW = 7
            const bx = tp.x - nx * aSize, by = tp.y - ny * aSize

            return (
              <g key={i}>
                <path d={pathD} fill="none" stroke="#4fc3f7" strokeWidth={8} opacity={0.12} />
                <path d={pathD} fill="none" stroke="#4fc3f7" strokeWidth={5} opacity={0.25} />
                <path d={pathD} fill="none" stroke="#4fc3f7" strokeWidth={3} opacity={0.9} />
                <circle cx={fp.x} cy={fp.y} r={6} fill="#4fc3f7" />
                <polygon
                  points={`${tp.x},${tp.y} ${bx - ny * aW},${by + nx * aW} ${bx + ny * aW},${by - nx * aW}`}
                  fill="#4fc3f7"
                />
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
