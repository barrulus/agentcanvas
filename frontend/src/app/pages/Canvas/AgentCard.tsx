import { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { moveCard, resizeCard, bringToFront, removeCard } from '@/shared/state/canvasSlice'
import { removeSession } from '@/shared/state/agentsSlice'
import { AgentChat } from '../AgentChat/AgentChat'
import { wsManager } from '@/shared/ws/WebSocketManager'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface CardPosition {
  session_id: string; x: number; y: number; width: number; height: number; zOrder: number
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#666',
  running: '#4fc3f7',
  completed: '#66bb6a',
  error: '#ef5350',
  stopped: '#ffa726',
}

const PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'ollama': 'Ollama',
}

export function AgentCard({ card }: { card: CardPosition }) {
  const dispatch = useDispatch<AppDispatch>()
  const session = useSelector((s: RootState) => s.agents.sessions[card.session_id])
  const [expanded, setExpanded] = useState(false)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, cardX: 0, cardY: 0 })

  // --- Resize state ---
  const isResizing = useRef(false)
  const resizeDir = useRef('')
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
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
  }, [card, dispatch])

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

  if (!session) return null

  const statusColor = STATUS_COLORS[session.status] || '#666'
  const h = expanded ? Math.max(card.height, 500) : card.height

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
        height: h,
        zIndex: card.zOrder,
        background: '#1a1a2e',
        border: `1px solid ${statusColor}33`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px ${statusColor}22`,
        transition: 'box-shadow 0.2s',
      }}
    >
      {/* Header / drag handle */}
      <div
        onMouseDown={handleDragStart}
        onDoubleClick={() => setExpanded(!expanded)}
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'grab',
          background: '#16162a',
          borderBottom: `1px solid ${statusColor}22`,
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        {/* Status dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: statusColor,
          boxShadow: session.status === 'running' ? `0 0 8px ${statusColor}` : 'none',
          animation: session.status === 'running' ? 'pulse 2s infinite' : 'none',
        }} />

        {/* Provider + model */}
        <span style={{ fontSize: 11, color: '#888', fontWeight: 500 }}>
          {PROVIDER_LABELS[session.provider_id] || session.provider_id}
        </span>
        <span style={{ fontSize: 11, color: '#555' }}>
          {session.model}
        </span>

        <span style={{ flex: 1 }} />

        {/* Name */}
        <span style={{ fontSize: 13, fontWeight: 600, color: '#ccc' }}>
          {session.name || 'Agent'}
        </span>

        <span style={{ flex: 1 }} />

        {/* Cost */}
        {session.cost_usd > 0 && (
          <span style={{ fontSize: 10, color: '#666' }}>
            ${session.cost_usd.toFixed(4)}
          </span>
        )}

        {/* Message count */}
        <span style={{ fontSize: 10, color: '#555' }}>
          {session.messages.length} msgs
        </span>

        {/* Stop button */}
        {session.status === 'running' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              wsManager.stopAgent(card.session_id)
            }}
            style={{
              background: 'none', border: '1px solid #ef535055', color: '#ef5350',
              cursor: 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 4,
              fontWeight: 600,
            }}
            title="Stop agent"
          >
            Stop
          </button>
        )}

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            fetch(`/api/sessions/${card.session_id}/close`, { method: 'POST' })
            dispatch(removeCard(card.session_id))
            dispatch(removeSession(card.session_id))
          }}
          style={{
            background: 'none', border: 'none', color: '#555', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '0 2px', marginLeft: 4,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef5350')}
          onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          title="Close agent"
        >
          ×
        </button>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {expanded ? (
          <AgentChat sessionId={card.session_id} />
        ) : (
          <CollapsedPreview session={session} />
        )}
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

const previewMdComponents = {
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
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #2a2a3e', margin: '4px 0' }} />,
  a: ({ children }: any) => <span style={{ color: '#4fc3f7' }}>{children}</span>,
  blockquote: ({ children }: any) => <blockquote style={{ borderLeft: '2px solid #4fc3f7', paddingLeft: 8, margin: '3px 0', color: '#888' }}>{children}</blockquote>,
  table: ({ children }: any) => <table style={{ borderCollapse: 'collapse', fontSize: 10, width: '100%' }}>{children}</table>,
  th: ({ children }: any) => <th style={{ border: '1px solid #333', padding: '2px 6px', background: '#1a1a2e', fontWeight: 600, textAlign: 'left' as const }}>{children}</th>,
  td: ({ children }: any) => <td style={{ border: '1px solid #2a2a3e', padding: '2px 6px' }}>{children}</td>,
}

function CollapsedPreview({ session }: { session: any }) {
  const lastMsg = [...session.messages].reverse().find((m: any) => m.role === 'assistant')
  const streaming = session.streamingMessage

  const text = streaming?.content || lastMsg?.content || ''
  const displayText = typeof text === 'string' ? text : JSON.stringify(text)

  return (
    <div style={{
      padding: '8px 12px',
      fontSize: 12,
      color: '#999',
      lineHeight: 1.5,
      overflow: 'hidden',
      maxHeight: '100%',
    }}>
      {displayText ? (
        <Markdown remarkPlugins={[remarkGfm]} components={previewMdComponents}>
          {displayText.slice(0, 800)}
        </Markdown>
      ) : (
        <span style={{ color: '#555', fontStyle: 'italic' }}>No messages yet</span>
      )}
      {streaming && (
        <span style={{ color: '#4fc3f7' }}>|</span>
      )}
    </div>
  )
}
