import { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { moveCard, moveSelected, resizeCard, bringToFront, removeCard, setSelected, toggleCardCollapsed } from '@/shared/state/canvasSlice'
import { MergeCard, removeMergeCard, updateMergeCard, resetMergeCard } from '@/shared/state/mergeCardsSlice'

interface CardPosition {
  session_id: string; x: number; y: number; width: number; height: number; zOrder: number; collapsed?: boolean
}

const STATUS_COLORS: Record<MergeCard['status'], string> = {
  idle: '#666',
  waiting: '#4fc3f7',
  completed: '#66bb6a',
  error: '#ef5350',
}

export function MergeCardComponent({ card, chromeless = false }: { card: CardPosition; chromeless?: boolean }) {
  const dispatch = useDispatch<AppDispatch>()
  const mergeCard = useSelector((s: RootState) => s.mergeCards.cards[card.session_id])
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, cardX: 0, cardY: 0 })
  const isResizing = useRef(false)
  const resizeDir = useRef('')
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 })

  const selectedCards = useSelector((s: RootState) => s.canvas.selectedCards)

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(mergeCard?.name || 'Merge')
  const [editTemplate, setEditTemplate] = useState(mergeCard?.template || '')
  const [editTimeout, setEditTimeout] = useState(mergeCard?.timeout_seconds ?? 60)

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
    const isGroupDrag = selectedCards.includes(card.session_id) && selectedCards.length > 1
    let lastDx = 0, lastDy = 0

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const dx = ev.clientX - dragStart.current.x
      const dy = ev.clientY - dragStart.current.y
      if (isGroupDrag) {
        dispatch(moveSelected({ dx: dx - lastDx, dy: dy - lastDy, ids: selectedCards }))
        lastDx = dx; lastDy = dy
      } else {
        dispatch(moveCard({ sessionId: card.session_id, x: dragStart.current.cardX + dx, y: dragStart.current.cardY + dy }))
      }
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

  const onSave = async () => {
    await dispatch(updateMergeCard({
      id: card.session_id,
      updates: { name: editName, template: editTemplate, timeout_seconds: editTimeout },
    }))
    setEditing(false)
  }

  const onDelete = () => {
    fetch(`/api/merge-cards/${card.session_id}`, { method: 'DELETE' })
    dispatch(removeCard(card.session_id))
    dispatch(removeMergeCard(card.session_id))
  }

  if (!mergeCard) return null

  const statusColor = STATUS_COLORS[mergeCard.status] || '#666'
  const isSelected = selectedCards.includes(card.session_id)

  if (card.collapsed) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        onMouseDown={chromeless ? undefined : handleDragStart}
        onDoubleClick={() => dispatch(toggleCardCollapsed(card.session_id))}
        style={{
          position: chromeless ? 'relative' : 'absolute',
          ...(chromeless ? {} : { left: card.x, top: card.y, zIndex: card.zOrder }),
          width: 200,
          height: 44,
          background: '#1a1a2e',
          border: isSelected ? '2px solid #66bb6a' : '1px solid #00446b44',
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
        <span style={{ fontSize: 10, color: '#4fc3f7', fontWeight: 600 }}>MERGE</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0', whiteSpace: 'nowrap' }}>
          {mergeCard.name}
        </span>
      </motion.div>
    )
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        style={{
          position: chromeless ? 'relative' : 'absolute',
          ...(chromeless ? {} : { left: card.x, top: card.y, zIndex: card.zOrder }),
          width: card.width,
          height: card.height,
          background: '#1a1a2e',
          border: isSelected ? '2px solid #66bb6a' : '1px solid #00446b33',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px #00446b22',
        }}
      >
        {/* Header */}
        <div
          onMouseDown={chromeless ? undefined : handleDragStart}
          onDoubleClick={() => dispatch(toggleCardCollapsed(card.session_id))}
          style={{
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'grab',
            background: '#10161a',
            borderBottom: '1px solid #00446b22',
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#4fc3f7', background: '#002840', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>
            MERGE
          </span>
          <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>
            merge · {Object.keys(mergeCard?.slots || {}).length}/{mergeCard?.expected_slots?.length || 0}
          </span>

          <span style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
            {mergeCard.name || 'Merge'}
          </span>

          <span style={{ flex: 1 }} />

          {/* Edit button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setEditName(mergeCard?.name || 'Merge')
              setEditTemplate(mergeCard?.template || '')
              setEditTimeout(mergeCard?.timeout_seconds ?? 60)
              setEditing(true)
            }}
            style={{
              background: 'none', border: '1px solid #333', color: '#888', cursor: 'pointer',
              fontSize: 10, padding: '1px 6px', borderRadius: 3,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#4fc3f7')}
            onMouseLeave={e => (e.currentTarget.style.color = '#888')}
            title="Edit merge card"
          >
            Edit
          </button>

          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            style={{
              background: 'none', border: 'none', color: '#555', cursor: 'pointer',
              fontSize: 16, lineHeight: 1, padding: '0 2px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef5350')}
            onMouseLeave={e => (e.currentTarget.style.color = '#555')}
            title="Delete merge card"
          >
            x
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Status bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 8px', background: '#12121e', borderRadius: 6, fontSize: 11,
          }}>
            <span style={{ color: statusColor, fontWeight: 600 }}>
              {mergeCard.status === 'idle' && 'Idle'}
              {mergeCard.status === 'waiting' && 'Waiting for slots'}
              {mergeCard.status === 'completed' && 'Completed'}
              {mergeCard.status === 'error' && 'Error'}
            </span>
          </div>

          {/* Slot grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
            {(mergeCard?.expected_slots || []).map(name => {
              const value = mergeCard?.slots[name]
              const filled = value !== undefined
              return (
                <div key={name} style={{ display: 'flex', gap: 6, color: filled ? '#9fd9ff' : '#555' }}>
                  <span style={{ width: 12 }}>{filled ? '✓' : '·'}</span>
                  <span style={{ width: 90, fontWeight: 600, fontFamily: 'monospace' }}>{name}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {filled ? value!.slice(0, 60) : '(waiting)'}
                  </span>
                </div>
              )
            })}
            {(!mergeCard?.expected_slots || mergeCard.expected_slots.length === 0) && (
              <span style={{ color: '#555', fontSize: 11 }}>No inbound edges yet — connect upstream agents.</span>
            )}
          </div>

          {/* Template (read-only preview, click to edit) */}
          {mergeCard?.template && (
            <div style={{
              padding: 6, background: '#0d0d1f', border: '1px solid #2a2a44',
              borderRadius: 6, fontSize: 11, color: '#a0a0c0', fontFamily: 'monospace',
              whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto',
            }}>
              <div style={{ fontSize: 9, color: '#666', marginBottom: 2 }}>template</div>
              {mergeCard.template}
            </div>
          )}

          {/* Error + reset */}
          {mergeCard?.status === 'error' && mergeCard.error_text && (
            <div style={{ background: '#3a1a1a', border: '1px solid #ef5350', borderRadius: 6, padding: 6, fontSize: 11, color: '#ef9a9a' }}>
              {mergeCard.error_text}
              <button
                onClick={(e) => { e.stopPropagation(); dispatch(resetMergeCard(card.session_id)) }}
                style={{ marginLeft: 8, padding: '2px 8px', background: '#ef5350', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
              >
                Reset
              </button>
            </div>
          )}

          {/* Last emission preview */}
          {mergeCard?.last_emitted_text && (
            <div style={{
              padding: 6, background: '#0d1f0d', border: '1px solid #2a4a2a',
              borderRadius: 6, fontSize: 11, color: '#a0d0a0', maxHeight: 80, overflow: 'auto',
            }}>
              <div style={{ fontSize: 9, color: '#666', marginBottom: 2 }}>last emission</div>
              {mergeCard.last_emitted_text.slice(0, 240)}
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

      {/* Edit dialog overlay */}
      {editing && (
        <div
          onClick={() => setEditing(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#1a1a2e', border: '1px solid #333', borderRadius: 12,
              padding: 24, width: 420, display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', marginBottom: 4 }}>Edit Merge Card</div>

            <label style={{ fontSize: 11, color: '#888' }}>Name</label>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              style={{ padding: '6px 10px', background: '#12121e', color: '#e0e0e0', border: '1px solid #333', borderRadius: 4, fontSize: 12 }}
            />

            <label style={{ fontSize: 11, color: '#888' }}>Template — use {`{{slot.<UpstreamName>[.field]}}`}</label>
            <textarea
              value={editTemplate}
              onChange={e => setEditTemplate(e.target.value)}
              style={{ padding: '6px 10px', background: '#12121e', color: '#e0e0e0', border: '1px solid #333', borderRadius: 4, fontSize: 12, minHeight: 100, fontFamily: 'monospace', resize: 'vertical' }}
            />

            <label style={{ fontSize: 11, color: '#888' }}>Timeout seconds (0 = wait forever)</label>
            <input
              type="number"
              min={0}
              value={editTimeout}
              onChange={e => setEditTimeout(parseInt(e.target.value || '0', 10))}
              style={{ padding: '6px 10px', background: '#12121e', color: '#e0e0e0', border: '1px solid #333', borderRadius: 4, fontSize: 12 }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={() => setEditing(false)}
                style={{ padding: '6px 16px', background: 'none', color: '#888', border: '1px solid #333', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                style={{ padding: '6px 16px', background: '#4fc3f7', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
