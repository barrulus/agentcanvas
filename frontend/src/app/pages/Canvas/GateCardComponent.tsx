import { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { moveCard, resizeCard, bringToFront, removeCard, setSelected, toggleCardCollapsed } from '@/shared/state/canvasSlice'
import { removeGateCard } from '@/shared/state/gateCardsSlice'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface CardPosition {
  session_id: string; x: number; y: number; width: number; height: number; zOrder: number; collapsed?: boolean
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#666',
  waiting: '#ffa726',
  resolving: '#4fc3f7',
  completed: '#66bb6a',
  error: '#ef5350',
}

export function GateCardComponent({ card }: { card: CardPosition }) {
  const dispatch = useDispatch<AppDispatch>()
  const gateCard = useSelector((s: RootState) => s.gateCards.cards[card.session_id])
  const connections = useSelector((s: RootState) => s.canvas.connections)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, cardX: 0, cardY: 0 })
  const isResizing = useRef(false)
  const resizeDir = useRef('')
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 })

  const selectedCards = useSelector((s: RootState) => s.canvas.selectedCards)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey) {
      const isSelected = selectedCards.includes(card.session_id)
      if (isSelected) {
        dispatch(setSelected(selectedCards.filter(id => id !== card.session_id)))
      } else {
        dispatch(setSelected([...selectedCards, card.session_id]))
      }
      return
    }
    isDragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY, cardX: card.x, cardY: card.y }
    dispatch(bringToFront(card.session_id))

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const dx = ev.clientX - dragStart.current.x
      const dy = ev.clientY - dragStart.current.y
      dispatch(moveCard({ sessionId: card.session_id, x: dragStart.current.cardX + dx, y: dragStart.current.cardY + dy }))
    }
    const onUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [card, dispatch, selectedCards])

  const handleResizeStart = useCallback((e: React.MouseEvent, dir: string) => {
    e.stopPropagation()
    e.preventDefault()
    isResizing.current = true
    resizeDir.current = dir
    resizeStart.current = { x: e.clientX, y: e.clientY, w: card.width, h: card.height, cx: card.x, cy: card.y }
    dispatch(bringToFront(card.session_id))

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const dx = ev.clientX - resizeStart.current.x
      const dy = ev.clientY - resizeStart.current.y
      let { w, h, cx, cy } = resizeStart.current

      if (dir.includes('e')) w += dx
      if (dir.includes('w')) { w -= dx; cx += dx }
      if (dir.includes('s')) h += dy
      if (dir.includes('n')) { h -= dy; cy += dy }

      dispatch(resizeCard({ sessionId: card.session_id, width: w, height: h, x: cx, y: cy }))
    }
    const onUp = () => {
      isResizing.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [card, dispatch])

  const handleNameDoubleClick = () => {
    if (!gateCard) return
    setNameValue(gateCard.name)
    setEditingName(true)
  }

  const handleNameSubmit = () => {
    setEditingName(false)
    if (gateCard && nameValue.trim() && nameValue.trim() !== gateCard.name) {
      fetch(`/api/gate-cards/${gateCard.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameValue.trim() }),
      })
    }
  }

  if (!gateCard) return null

  const upstreamCount = connections.filter(c => c.to === card.session_id).length
  const receivedCount = Object.keys(gateCard.pending_inputs).length
  const statusColor = STATUS_COLORS[gateCard.status] || '#666'
  const isSelected = selectedCards.includes(card.session_id)

  if (card.collapsed) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        onMouseDown={handleDragStart}
        onDoubleClick={() => dispatch(toggleCardCollapsed(card.session_id))}
        style={{
          position: 'absolute',
          left: card.x,
          top: card.y,
          width: 200,
          height: 44,
          zIndex: card.zOrder,
          background: '#1a1a2e',
          border: isSelected ? '2px solid #66bb6a' : '1px solid #6b400044',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          gap: 8,
          cursor: 'grab',
          userSelect: 'none',
          boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: '#ff9800', fontWeight: 600 }}>GATE</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0', whiteSpace: 'nowrap' }}>
          {gateCard.name}
        </span>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      style={{
        position: 'absolute',
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
        zIndex: card.zOrder,
        background: '#1a1a2e',
        border: isSelected ? '2px solid #66bb6a' : '1px solid #6b400033',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px #6b400022',
      }}
    >
      {/* Header */}
      <div
        onMouseDown={handleDragStart}
        onDoubleClick={() => dispatch(toggleCardCollapsed(card.session_id))}
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'grab',
          background: '#1a1610',
          borderBottom: '1px solid #6b400022',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: '#ff9800', background: '#3d2800', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>
          GATE
        </span>
        <span style={{ fontSize: 9, color: '#888', textTransform: 'uppercase' }}>
          {gateCard.mode}
        </span>

        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={e => { if (e.key === 'Enter') handleNameSubmit(); if (e.key === 'Escape') setEditingName(false) }}
            style={{
              fontSize: 13, fontWeight: 600, color: '#e0e0e0', background: '#12121e',
              border: '1px solid #ff9800', borderRadius: 4, padding: '1px 6px', outline: 'none',
              width: 120,
            }}
          />
        ) : (
          <span
            onDoubleClick={handleNameDoubleClick}
            style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}
            title="Double-click to rename"
          >
            {gateCard.name}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {/* Reset button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            fetch(`/api/gate-cards/${gateCard.id}/reset`, { method: 'POST' })
          }}
          style={{
            background: 'none', border: '1px solid #333', color: '#888', cursor: 'pointer',
            fontSize: 10, padding: '1px 6px', borderRadius: 3,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ff9800')}
          onMouseLeave={e => (e.currentTarget.style.color = '#888')}
          title="Reset gate (clear inputs)"
        >
          Reset
        </button>

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            fetch(`/api/gate-cards/${gateCard.id}`, { method: 'DELETE' })
            dispatch(removeCard(card.session_id))
            dispatch(removeGateCard(gateCard.id))
          }}
          style={{
            background: 'none', border: 'none', color: '#555', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '0 2px',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef5350')}
          onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          title="Delete gate card"
        >
          x
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px', fontSize: 12, color: '#999', lineHeight: 1.5 }}>
        {/* Status bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
          padding: '4px 8px', background: '#12121e', borderRadius: 6, fontSize: 11,
        }}>
          <span style={{ color: statusColor, fontWeight: 600 }}>
            {gateCard.status === 'idle' && 'Idle'}
            {gateCard.status === 'waiting' && `Waiting for inputs (${receivedCount}/${upstreamCount})`}
            {gateCard.status === 'resolving' && 'Resolving...'}
            {gateCard.status === 'completed' && 'Resolved'}
            {gateCard.status === 'error' && 'Error'}
          </span>
          <span style={{ color: '#555', marginLeft: 'auto', fontSize: 10 }}>
            {gateCard.provider_id} / {gateCard.model}
          </span>
        </div>

        {/* Pending inputs preview */}
        {receivedCount > 0 && gateCard.status !== 'completed' && (
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 4 }}>Received inputs:</span>
            {Object.entries(gateCard.pending_inputs).map(([connId, text], i) => (
              <div key={connId} style={{
                padding: '3px 6px', background: '#12121e', borderRadius: 4, marginBottom: 2,
                fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                Input {i + 1}: {text.slice(0, 80)}{text.length > 80 ? '...' : ''}
              </div>
            ))}
          </div>
        )}

        {/* Resolved output */}
        {gateCard.resolved_output ? (
          <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {gateCard.resolved_output}
          </Markdown>
        ) : gateCard.status === 'idle' ? (
          <span style={{ color: '#555', fontStyle: 'italic' }}>
            Connect upstream agents to this gate. It will auto-resolve when all inputs arrive.
          </span>
        ) : null}
      </div>

      {/* Resize handles */}
      {['n','s','e','w','ne','nw','se','sw'].map(dir => (
        <div
          key={dir}
          onMouseDown={(e) => handleResizeStart(e, dir)}
          style={{
            position: 'absolute',
            ...(dir.includes('n') ? { top: -3 } : {}),
            ...(dir.includes('s') ? { bottom: -3 } : {}),
            ...(dir.includes('e') ? { right: -3 } : {}),
            ...(dir.includes('w') ? { left: -3 } : {}),
            ...(!dir.includes('n') && !dir.includes('s') ? { top: 8, bottom: 8 } : {}),
            ...(!dir.includes('e') && !dir.includes('w') ? { left: 8, right: 8 } : {}),
            width: dir.length === 1 && (dir === 'e' || dir === 'w') ? 6 : dir.length === 2 ? 12 : undefined,
            height: dir.length === 1 && (dir === 'n' || dir === 's') ? 6 : dir.length === 2 ? 12 : undefined,
            cursor: `${dir === 'n' || dir === 's' ? 'ns' : dir === 'e' || dir === 'w' ? 'ew' : dir === 'ne' || dir === 'sw' ? 'nesw' : 'nwse'}-resize`,
            zIndex: 10,
          }}
        />
      ))}
    </motion.div>
  )
}

const mdComponents = {
  p: ({ children }: any) => <p style={{ margin: '2px 0' }}>{children}</p>,
  h1: ({ children }: any) => <h1 style={{ fontSize: 14, fontWeight: 700, margin: '4px 0 2px', color: '#bbb' }}>{children}</h1>,
  h2: ({ children }: any) => <h2 style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 2px', color: '#bbb' }}>{children}</h2>,
  h3: ({ children }: any) => <h3 style={{ fontSize: 12, fontWeight: 700, margin: '3px 0 2px', color: '#bbb' }}>{children}</h3>,
  ul: ({ children }: any) => <ul style={{ margin: '2px 0', paddingLeft: 16 }}>{children}</ul>,
  ol: ({ children }: any) => <ol style={{ margin: '2px 0', paddingLeft: 16 }}>{children}</ol>,
  li: ({ children }: any) => <li style={{ margin: '1px 0' }}>{children}</li>,
  code: ({ className, children }: any) => {
    if (className?.startsWith('language-')) {
      return (
        <pre style={{ background: '#0d0d1a', borderRadius: 4, padding: '4px 6px', overflow: 'hidden', margin: '3px 0', fontSize: 10 }}>
          <code style={{ fontFamily: "'JetBrains Mono', monospace", color: '#a0a8b8' }}>{children}</code>
        </pre>
      )
    }
    return <code style={{ background: '#1e1e32', padding: '0 3px', borderRadius: 2, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: '#a0a8b8' }}>{children}</code>
  },
  pre: ({ children }: any) => <>{children}</>,
  strong: ({ children }: any) => <strong style={{ color: '#bbb', fontWeight: 600 }}>{children}</strong>,
  em: ({ children }: any) => <em style={{ color: '#999' }}>{children}</em>,
  a: ({ children }: any) => <span style={{ color: '#ff9800' }}>{children}</span>,
}
