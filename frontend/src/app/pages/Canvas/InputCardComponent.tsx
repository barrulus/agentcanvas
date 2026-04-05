import { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { moveCard, resizeCard, bringToFront, removeCard, setSelected, toggleCardCollapsed } from '@/shared/state/canvasSlice'
import { removeInputCard, sendInputCard, updateInputCard } from '@/shared/state/inputCardsSlice'

interface CardPosition {
  session_id: string; x: number; y: number; width: number; height: number; zOrder: number; collapsed?: boolean
}

export function InputCardComponent({ card }: { card: CardPosition }) {
  const dispatch = useDispatch<AppDispatch>()
  const inputCard = useSelector((s: RootState) => s.inputCards.cards[card.session_id])
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
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
  }, [card, dispatch, selectedCards])

  const handleNameDoubleClick = () => {
    if (!inputCard) return
    setNameValue(inputCard.name)
    setEditingName(true)
  }

  const handleNameSubmit = () => {
    setEditingName(false)
    if (inputCard && nameValue.trim() && nameValue.trim() !== inputCard.name) {
      dispatch(updateInputCard({ id: inputCard.id, name: nameValue.trim() }))
    }
  }

  const handleSend = async () => {
    if (!chatInput.trim() || sending) return
    setSending(true)
    await dispatch(sendInputCard({ id: card.session_id, content: chatInput.trim() }))
    setChatInput('')
    setSending(false)
  }

  if (!inputCard) return null

  const isSelected = selectedCards.includes(card.session_id)
  const sourceColor = inputCard.source_type === 'webhook' ? '#ffa726' : inputCard.source_type === 'file' ? '#66bb6a' : '#4fc3f7'
  const sourceLabel = inputCard.source_type.toUpperCase()

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
          border: isSelected ? '2px solid #66bb6a' : `1px solid ${sourceColor}44`,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          gap: 8,
          cursor: 'grab',
          userSelect: 'none',
          boxShadow: `0 2px 12px rgba(0,0,0,0.3), 0 0 0 1px ${sourceColor}22`,
        }}
      >
        <span style={{ fontSize: 10, color: sourceColor, fontWeight: 600 }}>INPUT</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0', whiteSpace: 'nowrap' }}>
          {inputCard.name}
        </span>
        <span style={{ fontSize: 9, color: '#555' }}>{sourceLabel}</span>
      </motion.div>
    )
  }
  const webhookUrl = inputCard.source_type === 'webhook'
    ? `${window.location.origin}/api/input-cards/${inputCard.id}/webhook`
    : null

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
        border: isSelected ? '2px solid #66bb6a' : `1px solid ${sourceColor}33`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px ${sourceColor}22`,
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
          background: '#16162a',
          borderBottom: `1px solid ${sourceColor}22`,
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 10, color: sourceColor, background: `${sourceColor}1a`, padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>
          INPUT
        </span>
        <span style={{ fontSize: 9, color: '#666', background: '#1a1a2e', padding: '1px 4px', borderRadius: 2 }}>
          {sourceLabel}
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
              border: `1px solid ${sourceColor}`, borderRadius: 4, padding: '1px 6px', outline: 'none',
              width: 140,
            }}
          />
        ) : (
          <span
            onDoubleClick={handleNameDoubleClick}
            style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}
            title="Double-click to rename"
          >
            {inputCard.name}
          </span>
        )}

        <span style={{ flex: 1 }} />

        <button
          onClick={(e) => {
            e.stopPropagation()
            fetch(`/api/input-cards/${inputCard.id}`, { method: 'DELETE' })
            dispatch(removeCard(card.session_id))
            dispatch(removeInputCard(inputCard.id))
          }}
          style={{
            background: 'none', border: 'none', color: '#555', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '0 2px',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef5350')}
          onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          title="Delete input card"
        >
          x
        </button>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {inputCard.source_type === 'chat' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <span style={{ color: '#555', fontSize: 11, marginBottom: 8 }}>
              Type a message to send to connected agents
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="Enter input..."
                style={{
                  flex: 1, padding: '8px 10px', resize: 'vertical',
                  background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                  borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
                  minHeight: 36, maxHeight: 200,
                }}
              />
              <button
                onClick={handleSend}
                disabled={!chatInput.trim() || sending}
                style={{
                  padding: '8px 14px', background: sourceColor, color: '#000',
                  border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer',
                  fontSize: 12, alignSelf: 'flex-end',
                  opacity: (!chatInput.trim() || sending) ? 0.4 : 1,
                }}
              >
                Send
              </button>
            </div>
          </div>
        )}

        {inputCard.source_type === 'webhook' && webhookUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ color: '#888', fontSize: 11 }}>Webhook endpoint</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <code style={{
                flex: 1, padding: '6px 8px', background: '#12121e', color: '#ffa726',
                borderRadius: 4, fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                border: '1px solid #333',
              }}>
                {webhookUrl}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(webhookUrl)}
                style={{
                  padding: '4px 8px', background: '#2a2a3e', color: '#ccc',
                  border: '1px solid #444', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                }}
                title="Copy webhook URL"
              >
                Copy
              </button>
            </div>
            <span style={{ color: '#555', fontSize: 10 }}>
              POST JSON with a "content", "text", or "data" field
            </span>
          </div>
        )}

        {inputCard.source_type === 'file' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ color: '#888', fontSize: 11 }}>Watching file/directory</span>
            <code style={{
              padding: '6px 8px', background: '#12121e', color: '#66bb6a',
              borderRadius: 4, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              border: '1px solid #333',
            }}>
              {inputCard.config.path || 'No path configured'}
            </code>
            <span style={{ color: '#555', fontSize: 10 }}>
              Content is sent downstream when the file changes (polled every 2s)
            </span>
          </div>
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
