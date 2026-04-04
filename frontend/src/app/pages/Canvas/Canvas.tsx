import { useRef, useState, useCallback, useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { AnimatePresence } from 'framer-motion'
import { RootState, AppDispatch } from '@/shared/state/store'
import { AgentCard } from './AgentCard'
import { ViewCardComponent } from './ViewCardComponent'
import { debouncedSaveLayout, addConnection, removeConnection, updateConnectionContract, toggleGroupCollapsed, moveGroup, deleteGroup, renameGroup } from '@/shared/state/canvasSlice'

type Port = { x: number; y: number; nx: number; ny: number }

function getCardPorts(card: { x: number; y: number; width: number; height: number }): Port[] {
  const cx = card.x + card.width / 2
  const cy = card.y + card.height / 2
  return [
    { x: card.x + card.width, y: cy, nx: 1, ny: 0 },  // right
    { x: card.x, y: cy, nx: -1, ny: 0 },               // left
    { x: cx, y: card.y + card.height, nx: 0, ny: 1 },  // bottom
    { x: cx, y: card.y, nx: 0, ny: -1 },               // top
  ]
}

function bestPortPair(fromCard: { x: number; y: number; width: number; height: number }, toCard: { x: number; y: number; width: number; height: number }): [Port, Port] {
  const fromPorts = getCardPorts(fromCard)
  const toPorts = getCardPorts(toCard)
  let bestScore = -Infinity
  let fp = fromPorts[0], tp = toPorts[0]
  for (const f of fromPorts) {
    for (const t of toPorts) {
      const ex = t.x - f.x
      const ey = t.y - f.y
      const dist = Math.sqrt(ex * ex + ey * ey) || 1
      const srcAlign = (f.nx * ex + f.ny * ey) / dist
      const tgtAlign = -(t.nx * ex + t.ny * ey) / dist
      const score = srcAlign + tgtAlign - dist * 0.001
      if (score > bestScore) {
        bestScore = score
        fp = f; tp = t
      }
    }
  }
  return [fp, tp]
}

export function Canvas() {
  const dispatch = useDispatch<AppDispatch>()
  const cards = useSelector((s: RootState) => s.canvas.cards)
  const connections = useSelector((s: RootState) => s.canvas.connections)
  const groups = useSelector((s: RootState) => s.canvas.groups)
  const currentDashboardId = useSelector((s: RootState) => s.canvas.currentDashboardId)
  const contentRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  // Connection drawing state
  const [drawingFrom, setDrawingFrom] = useState<string | null>(null)
  const [drawingMouse, setDrawingMouse] = useState<{ x: number; y: number } | null>(null)

  // Connection context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; connId: string } | null>(null)

  // Connection editor popup
  const [editingConn, setEditingConn] = useState<{ connId: string; condition: string; outputSchema: string; transform: string } | null>(null)

  // Card hover state (for showing ports)
  const [hoverCardId, setHoverCardId] = useState<string | null>(null)

  // Group dragging state
  const groupDrag = useRef<{ groupId: string; startX: number; startY: number } | null>(null)

  useEffect(() => {
    if (Object.keys(cards).length > 0 || connections.length > 0 || Object.keys(groups).length > 0) {
      debouncedSaveLayout(currentDashboardId, cards, connections, groups)
    }
  }, [cards, connections, groups, currentDashboardId])

  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [zoom, setZoom] = useState(1)
  const isPanning = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  const clampZoom = useCallback((z: number) => Math.min(3, Math.max(0.15, z)), [])

  const handleFitToView = useCallback(() => {
    const cardList = Object.values(cards)
    if (cardList.length === 0) return
    const vEl = viewportRef.current
    if (!vEl) return
    const vw = vEl.clientWidth
    const vh = vEl.clientHeight

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of cardList) {
      minX = Math.min(minX, c.x)
      minY = Math.min(minY, c.y)
      maxX = Math.max(maxX, c.x + c.width)
      maxY = Math.max(maxY, c.y + c.height)
    }

    const pad = 40
    const scaleX = (vw - pad * 2) / (maxX - minX)
    const scaleY = (vh - pad * 2) / (maxY - minY)
    const newZoom = Math.min(3, Math.max(0.15, Math.min(scaleX, scaleY)))

    setZoom(newZoom)
    setPanX(-minX * newZoom + pad)
    setPanY(-minY * newZoom + pad)
  }, [cards])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.altKey) {
      e.preventDefault()
      const delta = -e.deltaY * 0.01
      setZoom(z => clampZoom(z * (1 + delta)))
    } else {
      setPanX(x => x - e.deltaX)
      setPanY(y => y - e.deltaY)
    }
  }, [clampZoom])

  const screenToCanvas = useCallback((sx: number, sy: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (sx - rect.left - panX) / zoom,
      y: (sy - rect.top - panY) / zoom,
    }
  }, [panX, panY, zoom])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (contextMenu) {
      setContextMenu(null)
      return
    }
    if (e.button === 1 || (e.button === 0 && e.target === viewportRef.current)) {
      isPanning.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
      e.preventDefault()
    }
  }, [contextMenu])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (drawingFrom) {
      setDrawingMouse(screenToCanvas(e.clientX, e.clientY))
      return
    }
    if (groupDrag.current) {
      const dx = (e.clientX - groupDrag.current.startX) / zoom
      const dy = (e.clientY - groupDrag.current.startY) / zoom
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        dispatch(moveGroup({ groupId: groupDrag.current.groupId, dx, dy }))
        groupDrag.current.startX = e.clientX
        groupDrag.current.startY = e.clientY
      }
      return
    }
    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      setPanX(x => x + dx)
      setPanY(y => y + dy)
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }
  }, [drawingFrom, screenToCanvas, zoom, dispatch])

  const handleMouseUp = useCallback(() => {
    isPanning.current = false
    groupDrag.current = null
    if (drawingFrom) {
      setDrawingFrom(null)
      setDrawingMouse(null)
    }
  }, [drawingFrom])

  // Port interaction: start drawing connection
  const handlePortMouseDown = useCallback((cardId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setDrawingFrom(cardId)
    setDrawingMouse(screenToCanvas(e.clientX, e.clientY))
  }, [screenToCanvas])

  // Port interaction: complete connection
  const handlePortMouseUp = useCallback((cardId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (drawingFrom && drawingFrom !== cardId) {
      dispatch(addConnection({ from: drawingFrom, to: cardId }))
    }
    setDrawingFrom(null)
    setDrawingMouse(null)
  }, [drawingFrom, dispatch])

  // Connection right-click
  const handleConnectionRightClick = useCallback((e: React.MouseEvent, connId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, connId })
  }, [])

  const handleDeleteConnection = useCallback(() => {
    if (contextMenu) {
      dispatch(removeConnection(contextMenu.connId))
      setContextMenu(null)
    }
  }, [contextMenu, dispatch])

  const handleEditContract = useCallback(() => {
    if (!contextMenu) return
    const conn = connections.find(c => c.id === contextMenu.connId)
    setEditingConn({
      connId: contextMenu.connId,
      condition: conn?.condition || '',
      outputSchema: conn?.output_schema ? JSON.stringify(conn.output_schema, null, 2) : '',
      transform: conn?.transform || '',
    })
    setContextMenu(null)
  }, [contextMenu, connections])

  const handleSaveContract = useCallback(() => {
    if (!editingConn) return
    let parsedSchema: Record<string, any> | undefined
    if (editingConn.outputSchema.trim()) {
      try {
        parsedSchema = JSON.parse(editingConn.outputSchema)
      } catch {
        alert('Invalid JSON in output schema')
        return
      }
    }
    dispatch(updateConnectionContract({
      id: editingConn.connId,
      condition: editingConn.condition || undefined,
      output_schema: parsedSchema,
      transform: editingConn.transform || undefined,
    }))
    setEditingConn(null)
  }, [editingConn, dispatch])

  // Render port circles for a card
  // Always render for hit-testing (mouseenter to trigger hover), but only show visually when `visible`
  const renderPorts = (cardId: string, card: { x: number; y: number; width: number; height: number }, visible: boolean) => {
    const ports = getCardPorts(card)
    return (
      <g key={`ports-${cardId}`}>
        {ports.map((p, i) => (
          <circle
            key={`port-${cardId}-${i}`}
            cx={p.x} cy={p.y} r={visible ? 7 : 12}
            fill={visible ? '#4fc3f7' : 'transparent'}
            fillOpacity={visible ? 0.2 : 0}
            stroke={visible ? '#4fc3f7' : 'transparent'}
            strokeWidth={visible ? 1.5 : 0}
            strokeOpacity={visible ? 0.5 : 0}
            style={{ cursor: visible ? 'crosshair' : 'default', pointerEvents: 'all' }}
            onMouseEnter={() => setHoverCardId(cardId)}
            onMouseLeave={() => setHoverCardId(h => h === cardId ? null : h)}
            onMouseDown={(e) => { if (visible) handlePortMouseDown(cardId, e as any) }}
            onMouseUp={(e) => handlePortMouseUp(cardId, e as any)}
          />
        ))}
      </g>
    )
  }

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
        cursor: drawingFrom ? 'crosshair' : isPanning.current ? 'grabbing' : 'default',
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
        {/* Group bounding boxes — rendered behind cards */}
        {Object.values(groups).map(group => {
          const memberCards = group.memberIds.map(id => cards[id]).filter(Boolean)
          if (memberCards.length === 0) return null

          if (group.collapsed) {
            // Collapsed: show compact card
            const firstCard = memberCards[0]
            return (
              <div
                key={`group-${group.id}`}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  groupDrag.current = { groupId: group.id, startX: e.clientX, startY: e.clientY }
                }}
                style={{
                  position: 'absolute',
                  left: firstCard.x,
                  top: firstCard.y,
                  width: 200,
                  height: 48,
                  zIndex: 0,
                  background: '#1a1a2e',
                  border: `2px dashed ${group.color || '#666'}`,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 12px',
                  gap: 8,
                  cursor: 'grab',
                  userSelect: 'none',
                }}
              >
                <button
                  onClick={() => dispatch(toggleGroupCollapsed(group.id))}
                  style={{ background: 'none', border: 'none', color: '#4fc3f7', cursor: 'pointer', fontSize: 14 }}
                  title="Expand group"
                >&#9654;</button>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</span>
                <span style={{ fontSize: 10, color: '#666' }}>{group.memberIds.length} cards</span>
              </div>
            )
          }

          // Expanded: dashed bounding box
          const pad = 16
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const c of memberCards) {
            minX = Math.min(minX, c.x)
            minY = Math.min(minY, c.y)
            maxX = Math.max(maxX, c.x + c.width)
            maxY = Math.max(maxY, c.y + c.height)
          }

          return (
            <div
              key={`group-${group.id}`}
              style={{
                position: 'absolute',
                left: minX - pad,
                top: minY - pad - 28,
                width: maxX - minX + pad * 2,
                height: maxY - minY + pad * 2 + 28,
                zIndex: 0,
                border: `2px dashed ${group.color || '#444'}`,
                borderRadius: 12,
                pointerEvents: 'none',
              }}
            >
              {/* Group header */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                  gap: 6,
                  pointerEvents: 'auto',
                  cursor: 'grab',
                  userSelect: 'none',
                }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  groupDrag.current = { groupId: group.id, startX: e.clientX, startY: e.clientY }
                }}
              >
                <button
                  onClick={() => dispatch(toggleGroupCollapsed(group.id))}
                  style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 10, padding: 0 }}
                  title="Collapse group"
                >&#9660;</button>
                <span
                  onDoubleClick={() => {
                    const name = window.prompt('Group name:', group.name)
                    if (name?.trim()) dispatch(renameGroup({ id: group.id, name: name.trim() }))
                  }}
                  style={{ fontSize: 11, fontWeight: 600, color: '#888', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title="Double-click to rename"
                >{group.name}</span>
                <button
                  onClick={() => dispatch(deleteGroup(group.id))}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, padding: 0 }}
                  title="Ungroup"
                >x</button>
              </div>
            </div>
          )
        })}

        <AnimatePresence>
          {Object.values(cards).map(card => {
            // Hide cards in collapsed groups
            const inCollapsedGroup = Object.values(groups).some(g => g.collapsed && g.memberIds.includes(card.session_id))
            if (inCollapsedGroup) return null
            return card.card_type === 'view'
              ? <ViewCardComponent key={card.session_id} card={card} />
              : <AgentCard key={card.session_id} card={card} />
          })}
        </AnimatePresence>

        {/* Connection lines and ports */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'visible', zIndex: 999999 }}>
          {/* Existing connections */}
          {connections.map((conn) => {
            const from = cards[conn.from]
            const to = cards[conn.to]
            if (!from || !to) return null

            const [fp, tp] = bestPortPair(from, to)

            const cpDist = Math.max(60, Math.sqrt((tp.x - fp.x) ** 2 + (tp.y - fp.y) ** 2) * 0.4)
            const cp1x = fp.x + fp.nx * cpDist
            const cp1y = fp.y + fp.ny * cpDist
            const cp2x = tp.x + tp.nx * cpDist
            const cp2y = tp.y + tp.ny * cpDist

            const pathD = `M ${fp.x} ${fp.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tp.x} ${tp.y}`

            const tx = tp.x - cp2x
            const ty = tp.y - cp2y
            const tlen = Math.sqrt(tx * tx + ty * ty) || 1
            const nx = tx / tlen
            const ny = ty / tlen
            const aSize = 14, aW = 7
            const bx = tp.x - nx * aSize, by = tp.y - ny * aSize

            const hasContract = conn.output_schema || conn.transform
            const color = hasContract ? '#b39ddb' : conn.condition ? '#ffa726' : '#4fc3f7'
            const dashArray = hasContract ? '8 4' : undefined
            const midX = (fp.x + tp.x) / 2
            const midY = (fp.y + tp.y) / 2

            return (
              <g key={conn.id || `${conn.from}-${conn.to}`} style={{ pointerEvents: 'none' }}>
                <path d={pathD} fill="none" stroke={color} strokeWidth={8} opacity={0.12} strokeDasharray={dashArray} />
                <path d={pathD} fill="none" stroke={color} strokeWidth={5} opacity={0.25} strokeDasharray={dashArray} />
                <path d={pathD} fill="none" stroke={color} strokeWidth={3} opacity={0.9} strokeDasharray={dashArray} />
                {/* Invisible wider path for click/right-click interaction */}
                <path
                  d={pathD} fill="none" stroke="rgba(0,0,0,0.01)" strokeWidth={20}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onContextMenu={(e) => { if (conn.id) handleConnectionRightClick(e, conn.id) }}
                  onClick={(e) => { if (conn.id) handleConnectionRightClick(e, conn.id) }}
                />
                <circle cx={fp.x} cy={fp.y} r={6} fill={color} style={{ pointerEvents: 'none' }} />
                <polygon
                  points={`${tp.x},${tp.y} ${bx - ny * aW},${by + nx * aW} ${bx + ny * aW},${by - nx * aW}`}
                  fill={color} style={{ pointerEvents: 'none' }}
                />
                {/* Connection labels */}
                {conn.condition && (
                  <text x={midX} y={midY - 8} fill="#ffa726" fontSize={10} textAnchor="middle" style={{ pointerEvents: 'none' }}>
                    {conn.condition}
                  </text>
                )}
                {hasContract && (
                  <text x={midX} y={midY + (conn.condition ? 8 : -8)} fill="#b39ddb" fontSize={9} textAnchor="middle" style={{ pointerEvents: 'none' }}>
                    {conn.output_schema ? 'schema' : ''}{conn.output_schema && conn.transform ? ' + ' : ''}{conn.transform ? 'transform' : ''}
                  </text>
                )}
              </g>
            )
          })}

          {/* Drawing-in-progress connection */}
          {drawingFrom && drawingMouse && cards[drawingFrom] && (() => {
            const fromCard = cards[drawingFrom]
            const ports = getCardPorts(fromCard)
            // Find nearest port to mouse
            let nearest = ports[0]
            let bestDist = Infinity
            for (const p of ports) {
              const d = Math.sqrt((p.x - drawingMouse.x) ** 2 + (p.y - drawingMouse.y) ** 2)
              if (d < bestDist) { bestDist = d; nearest = p }
            }
            return (
              <g>
                <line
                  x1={nearest.x} y1={nearest.y}
                  x2={drawingMouse.x} y2={drawingMouse.y}
                  stroke="#4fc3f7" strokeWidth={2} strokeDasharray="6 4" opacity={0.6}
                />
                <circle cx={nearest.x} cy={nearest.y} r={6} fill="#4fc3f7" />
                <circle cx={drawingMouse.x} cy={drawingMouse.y} r={4} fill="#4fc3f7" opacity={0.5} />
              </g>
            )
          })()}

          {/* Port circles on all cards (visible when drawing) */}
          {/* Port circles — always rendered but only visible on hover or when drawing */}
          {Object.entries(cards).map(([id, card]) => renderPorts(id, card, drawingFrom != null || hoverCardId === id))}
        </svg>
      </div>

      {/* Zoom controls */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16,
        display: 'flex', alignItems: 'center', gap: 4,
        background: '#1a1a2ecc', border: '1px solid #333',
        borderRadius: 8, padding: '4px 8px', zIndex: 100,
      }}>
        <button onClick={() => setZoom(z => clampZoom(z / 1.2))} style={zoomBtnStyle} title="Zoom out">-</button>
        <span style={{ fontSize: 11, color: '#888', minWidth: 40, textAlign: 'center', userSelect: 'none' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => setZoom(z => clampZoom(z * 1.2))} style={zoomBtnStyle} title="Zoom in">+</button>
        <button onClick={handleFitToView} style={{ ...zoomBtnStyle, fontSize: 11, padding: '4px 8px', width: 'auto' }} title="Fit all cards in view">Fit</button>
      </div>

      {/* Connection context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: '#1a1a2e', border: '1px solid #333', borderRadius: 8,
            padding: 4, zIndex: 100000, minWidth: 140,
          }}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            onClick={handleEditContract}
            style={ctxMenuItemStyle}
          >
            Edit data contract...
          </button>
          <button
            onClick={handleDeleteConnection}
            style={{ ...ctxMenuItemStyle, color: '#ef5350' }}
          >
            Delete connection
          </button>
        </div>
      )}

      {/* Connection editor popup */}
      {editingConn && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100001,
        }} onClick={() => setEditingConn(null)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#1a1a2e', borderRadius: 12, padding: 24,
              width: 480, border: '1px solid #333',
            }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#e0e0e0' }}>Connection Data Contract</h3>

            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>
              Routing condition
              <span style={{ color: '#555', fontWeight: 400 }}> — e.g. contains:error, regex:SUCCESS</span>
            </label>
            <input
              value={editingConn.condition}
              onChange={e => setEditingConn(c => c ? { ...c, condition: e.target.value } : c)}
              placeholder="Empty = always route"
              style={{
                width: '100%', padding: '8px 12px', marginBottom: 12,
                background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
              }}
            />

            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>
              Output schema (JSON Schema)
              <span style={{ color: '#555', fontWeight: 400 }}> — validates output before routing</span>
            </label>
            <textarea
              value={editingConn.outputSchema}
              onChange={e => setEditingConn(c => c ? { ...c, outputSchema: e.target.value } : c)}
              placeholder='{"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}}'
              style={{
                width: '100%', padding: '8px 12px', marginBottom: 12,
                background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                borderRadius: 6, fontSize: 12, minHeight: 80, resize: 'vertical',
                fontFamily: 'monospace', boxSizing: 'border-box',
              }}
            />

            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>
              Transform template
              <span style={{ color: '#555', fontWeight: 400 }}>{' — {{output}} for full text, {{output.field}} for JSON fields'}</span>
            </label>
            <textarea
              value={editingConn.transform}
              onChange={e => setEditingConn(c => c ? { ...c, transform: e.target.value } : c)}
              placeholder="{{output.summary}}"
              style={{
                width: '100%', padding: '8px 12px', marginBottom: 16,
                background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                borderRadius: 6, fontSize: 12, minHeight: 48, resize: 'vertical',
                fontFamily: 'monospace', boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditingConn(null)}
                style={{
                  padding: '8px 16px', background: 'transparent', color: '#888',
                  border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveContract}
                style={{
                  padding: '8px 16px', background: '#4fc3f7', color: '#000',
                  border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const zoomBtnStyle: React.CSSProperties = {
  background: '#2a2a3e', color: '#ccc', border: '1px solid #444',
  borderRadius: 4, width: 28, height: 28, fontSize: 16, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const ctxMenuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '6px 12px',
  background: 'transparent', color: '#ccc', border: 'none',
  fontSize: 12, cursor: 'pointer', textAlign: 'left', borderRadius: 4,
}
