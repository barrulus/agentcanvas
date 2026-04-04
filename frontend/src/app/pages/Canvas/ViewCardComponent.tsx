import { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { moveCard, resizeCard, bringToFront, removeCard, setSelected } from '@/shared/state/canvasSlice'
import { removeViewCard, updateViewCard } from '@/shared/state/viewCardsSlice'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface CardPosition {
  session_id: string; x: number; y: number; width: number; height: number; zOrder: number
}

export function ViewCardComponent({ card }: { card: CardPosition }) {
  const dispatch = useDispatch<AppDispatch>()
  const viewCard = useSelector((s: RootState) => s.viewCards.cards[card.session_id])
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

  const handleNameDoubleClick = () => {
    if (!viewCard) return
    setNameValue(viewCard.name)
    setEditingName(true)
  }

  const handleNameSubmit = () => {
    setEditingName(false)
    if (viewCard && nameValue.trim() && nameValue.trim() !== viewCard.name) {
      dispatch(updateViewCard({ id: viewCard.id, name: nameValue.trim() }))
    }
  }

  if (!viewCard) return null

  const isSelected = selectedCards.includes(card.session_id)

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
        border: isSelected ? '2px solid #66bb6a' : '1px solid #4a3a6633',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px #4a3a6622',
      }}
    >
      {/* Header */}
      <div
        onMouseDown={handleDragStart}
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'grab',
          background: '#16162a',
          borderBottom: '1px solid #4a3a6622',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        {/* View card indicator */}
        <span style={{ fontSize: 10, color: '#b39ddb', background: '#2a1a3e', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>
          VIEW
        </span>

        {/* Name */}
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={e => { if (e.key === 'Enter') handleNameSubmit(); if (e.key === 'Escape') setEditingName(false) }}
            style={{
              fontSize: 13, fontWeight: 600, color: '#e0e0e0', background: '#12121e',
              border: '1px solid #4fc3f7', borderRadius: 4, padding: '1px 6px', outline: 'none',
              width: 140,
            }}
          />
        ) : (
          <span
            onDoubleClick={handleNameDoubleClick}
            style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}
            title="Double-click to rename"
          >
            {viewCard.name}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            fetch(`/api/view-cards/${viewCard.id}`, { method: 'DELETE' })
            dispatch(removeCard(card.session_id))
            dispatch(removeViewCard(viewCard.id))
          }}
          style={{
            background: 'none', border: 'none', color: '#555', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '0 2px',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef5350')}
          onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          title="Delete view card"
        >
          x
        </button>
      </div>

      {/* Content area */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '8px 12px',
        fontSize: 12, color: '#999', lineHeight: 1.5,
      }}>
        {viewCard.content ? (
          <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {viewCard.content}
          </Markdown>
        ) : (
          <span style={{ color: '#555', fontStyle: 'italic' }}>No content — connect an agent to send output here</span>
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
  a: ({ children }: any) => <span style={{ color: '#b39ddb' }}>{children}</span>,
}
