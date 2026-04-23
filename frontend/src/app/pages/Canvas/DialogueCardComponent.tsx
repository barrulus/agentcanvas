import { useRef, useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { moveCard, moveSelected, resizeCard, bringToFront, removeCard, setSelected, toggleCardCollapsed } from '@/shared/state/canvasSlice'
import {
  removeDialogueCard, updateDialogueCard, startDialogueCard, resetDialogueCard, deleteDialogueCard,
  type DialogueParticipant,
} from '@/shared/state/dialogueCardsSlice'
import { fetchProviders } from '@/shared/state/agentsSlice'

interface CardPosition {
  session_id: string; x: number; y: number; width: number; height: number; zOrder: number; collapsed?: boolean
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#666',
  running: '#4fc3f7',
  completed: '#66bb6a',
  error: '#ef5350',
}

const ACCENT = '#ba68c8'

export function DialogueCardComponent({ card }: { card: CardPosition }) {
  const dispatch = useDispatch<AppDispatch>()
  const dialogueCard = useSelector((s: RootState) => s.dialogueCards.cards[card.session_id])
  const providers = useSelector((s: RootState) => s.agents.providers)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, cardX: 0, cardY: 0 })
  const isResizing = useRef(false)
  const resizeDir = useRef('')
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 })

  const selectedCards = useSelector((s: RootState) => s.canvas.selectedCards)

  useEffect(() => {
    if (providers.length === 0) dispatch(fetchProviders())
  }, [providers.length, dispatch])

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

  const handleNameDoubleClick = () => {
    if (!dialogueCard) return
    setNameValue(dialogueCard.name)
    setEditingName(true)
  }

  const handleNameSubmit = () => {
    setEditingName(false)
    if (dialogueCard && nameValue.trim() && nameValue.trim() !== dialogueCard.name) {
      dispatch(updateDialogueCard({ id: dialogueCard.id, updates: { name: nameValue.trim() } }))
    }
  }

  if (!dialogueCard) return null

  const statusColor = STATUS_COLORS[dialogueCard.status] || '#666'
  const isSelected = selectedCards.includes(card.session_id)
  const turns = dialogueCard.transcript || []
  const orchestrator = dialogueCard.participants.find(p => p.role === 'orchestrator')
  const workers = dialogueCard.participants.filter(p => p.role === 'worker')

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
          position: 'absolute', left: card.x, top: card.y, width: 200, height: 44,
          zIndex: card.zOrder, background: '#1a1a2e',
          border: isSelected ? '2px solid #66bb6a' : `1px solid ${ACCENT}44`,
          borderRadius: 10, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8,
          cursor: 'grab', userSelect: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
        <span style={{ fontSize: 10, color: ACCENT, fontWeight: 600 }}>DIALOG</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0', whiteSpace: 'nowrap' }}>
          {dialogueCard.name}
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
        position: 'absolute', left: card.x, top: card.y, width: card.width, height: card.height,
        zIndex: card.zOrder, background: '#1a1a2e',
        border: isSelected ? '2px solid #66bb6a' : `1px solid ${ACCENT}33`,
        borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px ${ACCENT}22`,
      }}
    >
      {/* Header */}
      <div
        onMouseDown={handleDragStart}
        onDoubleClick={() => dispatch(toggleCardCollapsed(card.session_id))}
        style={{
          padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'grab', background: '#20132a', borderBottom: `1px solid ${ACCENT}22`,
          flexShrink: 0, userSelect: 'none',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
        <span style={{ fontSize: 10, color: ACCENT, background: '#2a1630', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>
          DIALOG
        </span>
        <span style={{ fontSize: 9, color: '#888' }}>
          {dialogueCard.participants.length} participants
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
              border: `1px solid ${ACCENT}`, borderRadius: 4, padding: '1px 6px', outline: 'none', width: 120,
            }}
          />
        ) : (
          <span
            onDoubleClick={handleNameDoubleClick}
            style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}
            title="Double-click to rename"
          >
            {dialogueCard.name}
          </span>
        )}

        <span style={{ flex: 1 }} />

        <button
          onClick={(e) => { e.stopPropagation(); setConfigOpen(true) }}
          style={{ background: 'none', border: '1px solid #333', color: '#888', cursor: 'pointer', fontSize: 10, padding: '1px 6px', borderRadius: 3 }}
          title="Edit participants and settings"
        >
          Configure
        </button>
        {dialogueCard.status === 'idle' && (
          <button
            onClick={(e) => { e.stopPropagation(); dispatch(startDialogueCard(dialogueCard.id)) }}
            disabled={!orchestrator}
            style={{
              background: orchestrator ? ACCENT : '#333', border: 'none', color: orchestrator ? '#000' : '#666',
              cursor: orchestrator ? 'pointer' : 'not-allowed', fontSize: 10, padding: '2px 8px', borderRadius: 3, fontWeight: 600,
            }}
            title={orchestrator ? 'Run dialogue' : 'Add an orchestrator first'}
          >
            Run
          </button>
        )}
        {(dialogueCard.status === 'completed' || dialogueCard.status === 'error' || dialogueCard.status === 'running') && (
          <button
            onClick={(e) => { e.stopPropagation(); dispatch(resetDialogueCard(dialogueCard.id)) }}
            style={{ background: 'none', border: '1px solid #333', color: '#888', cursor: 'pointer', fontSize: 10, padding: '1px 6px', borderRadius: 3 }}
            title="Clear transcript"
          >
            Reset
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            dispatch(deleteDialogueCard(dialogueCard.id))
            dispatch(removeCard(card.session_id))
            dispatch(removeDialogueCard(dialogueCard.id))
          }}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
          title="Delete dialogue card"
        >
          x
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px', fontSize: 12, color: '#999', lineHeight: 1.4 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
          padding: '4px 8px', background: '#12121e', borderRadius: 6, fontSize: 11,
        }}>
          <span style={{ color: statusColor, fontWeight: 600 }}>
            {dialogueCard.status === 'idle' && 'Idle'}
            {dialogueCard.status === 'running' && (dialogueCard.current_speaker ? `${dialogueCard.current_speaker}…` : 'Running…')}
            {dialogueCard.status === 'completed' && 'Completed'}
            {dialogueCard.status === 'error' && 'Error'}
          </span>
          <span style={{ color: '#555', marginLeft: 'auto', fontSize: 10 }}>
            turn {turns.filter(t => t.speaker !== 'user').length}/{dialogueCard.max_turns}
          </span>
        </div>

        {dialogueCard.participants.length === 0 && (
          <div style={{ color: '#555', fontStyle: 'italic', padding: '8px 0' }}>
            No participants yet. Click <b style={{ color: ACCENT }}>Configure</b> to add an orchestrator and workers.
          </div>
        )}

        {dialogueCard.participants.length > 0 && turns.length === 0 && dialogueCard.status === 'idle' && (
          <div style={{ color: '#666', fontSize: 11, padding: '8px 0' }}>
            <div style={{ marginBottom: 4 }}>
              Orchestrator: <b style={{ color: ACCENT }}>{orchestrator?.name || '(none)'}</b>
            </div>
            <div>
              Workers: {workers.map(w => w.name).join(', ') || '(none)'}
            </div>
            {dialogueCard.initial_prompt && (
              <div style={{ marginTop: 8, padding: 6, background: '#12121e', borderRadius: 4, color: '#888', fontSize: 10 }}>
                {dialogueCard.initial_prompt.slice(0, 200)}{dialogueCard.initial_prompt.length > 200 ? '…' : ''}
              </div>
            )}
          </div>
        )}

        {/* Transcript */}
        {turns.map((t, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: t.speaker === 'user' ? '#888' : (dialogueCard.participants.find(p => p.name === t.speaker)?.role === 'orchestrator' ? ACCENT : '#4fc3f7'), fontWeight: 600, marginBottom: 2 }}>
              {t.speaker}
            </div>
            <div style={{ fontSize: 11, color: '#bbb', whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '4px 8px', background: '#12121e', borderRadius: 4 }}>
              {t.content}
            </div>
          </div>
        ))}

        {dialogueCard.status === 'completed' && dialogueCard.final_output && (
          <div style={{ marginTop: 10, padding: 8, background: '#12222a', borderRadius: 6, border: `1px solid ${ACCENT}33` }}>
            <div style={{ fontSize: 10, color: ACCENT, fontWeight: 600, marginBottom: 4 }}>FINAL OUTPUT</div>
            <div style={{ fontSize: 11, color: '#ddd', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {dialogueCard.final_output}
            </div>
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

    {configOpen && (
      <ConfigureDialog
        card={dialogueCard}
        onClose={() => setConfigOpen(false)}
        onSave={(updates) => {
          dispatch(updateDialogueCard({ id: dialogueCard.id, updates }))
          setConfigOpen(false)
        }}
      />
    )}
    </>
  )
}

function ConfigureDialog({ card, onClose, onSave }: {
  card: { name: string; participants: DialogueParticipant[]; max_turns: number; termination_rule: string | null; initial_prompt: string; output_mode: 'last_message' | 'full_transcript' }
  onClose: () => void
  onSave: (updates: any) => void
}) {
  const providers = useSelector((s: RootState) => s.agents.providers)
  const [participants, setParticipants] = useState<DialogueParticipant[]>(card.participants || [])
  const [maxTurns, setMaxTurns] = useState(card.max_turns || 20)
  const [termination, setTermination] = useState(card.termination_rule || '')
  const [initialPrompt, setInitialPrompt] = useState(card.initial_prompt || '')
  const [outputMode, setOutputMode] = useState<'last_message' | 'full_transcript'>(card.output_mode || 'last_message')
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, Array<{ id: string; name: string }>>>({})

  const ensureModelsLoaded = async (providerId: string) => {
    if (!providerId || modelsByProvider[providerId]) return
    try {
      const res = await fetch(`/api/providers/${providerId}/models`)
      const data = await res.json()
      setModelsByProvider(m => ({ ...m, [providerId]: data.models || [] }))
    } catch {}
  }

  useEffect(() => {
    for (const p of participants) {
      if (p.provider_id) ensureModelsLoaded(p.provider_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addParticipant = (role: 'orchestrator' | 'worker') => {
    const defaultProvider = providers[0]?.id || ''
    setParticipants(prev => [
      ...prev,
      {
        name: role === 'orchestrator' ? 'Orchestrator' : `Worker ${prev.filter(p => p.role === 'worker').length + 1}`,
        description: '',
        role,
        provider_id: defaultProvider,
        model: '',
        system_prompt: '',
        context_mode: role === 'orchestrator' ? 'full' : 'question_only',
        context_last_n: 5,
        max_context_tokens: null,
      },
    ])
    if (defaultProvider) ensureModelsLoaded(defaultProvider)
  }

  const updatePart = (i: number, patch: Partial<DialogueParticipant>) => {
    setParticipants(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p))
    if (patch.provider_id) ensureModelsLoaded(patch.provider_id)
  }

  const removePart = (i: number) => {
    setParticipants(prev => prev.filter((_, idx) => idx !== i))
  }

  const hasOrchestrator = participants.some(p => p.role === 'orchestrator')
  const canSave = hasOrchestrator && participants.every(p => p.name.trim() && p.provider_id && p.model)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100002,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0a0a0f', borderRadius: 12, border: '1px solid #333',
          width: 640, maxHeight: '85vh', overflow: 'auto', padding: 24, position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer' }}
        >×</button>

        <h2 style={{ margin: '0 0 16px', fontSize: 18, color: '#e0e0e0' }}>Dialogue configuration</h2>

        <label style={labelStyle}>Initial prompt</label>
        <textarea
          value={initialPrompt}
          onChange={e => setInitialPrompt(e.target.value)}
          placeholder="The seed question / task that the orchestrator sees first."
          style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
        />

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Max turns</label>
            <input
              type="number" min={1} max={100}
              value={maxTurns}
              onChange={e => setMaxTurns(parseInt(e.target.value) || 1)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 2 }}>
            <label style={labelStyle}>Termination rule (optional)</label>
            <input
              value={termination}
              onChange={e => setTermination(e.target.value)}
              placeholder="contains:CONSENSUS  /  regex:\\b(DONE|AGREED)\\b"
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Output</label>
            <select
              value={outputMode}
              onChange={e => setOutputMode(e.target.value as any)}
              style={inputStyle}
            >
              <option value="last_message">Last message</option>
              <option value="full_transcript">Full transcript</option>
            </select>
          </div>
        </div>

        <h3 style={{ margin: '16px 0 8px', fontSize: 14, color: '#ccc' }}>
          Participants
          {!hasOrchestrator && <span style={{ color: '#ef5350', fontSize: 11, fontWeight: 400, marginLeft: 8 }}>Add one orchestrator to enable Run</span>}
        </h3>

        {participants.map((p, i) => (
          <div key={i} style={{
            background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 10, border: '1px solid #333',
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <select
                value={p.role}
                onChange={e => updatePart(i, { role: e.target.value as 'orchestrator' | 'worker' })}
                style={{ ...inputStyle, width: 130, marginBottom: 0 }}
              >
                <option value="orchestrator">Orchestrator</option>
                <option value="worker">Worker</option>
              </select>
              <input
                value={p.name}
                onChange={e => updatePart(i, { name: e.target.value })}
                placeholder="Name (used in {{ask:Name}})"
                style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
              />
              <button
                onClick={() => removePart(i)}
                style={{ background: 'transparent', color: '#e57373', border: '1px solid #5a2e2e', borderRadius: 4, cursor: 'pointer', padding: '4px 10px', fontSize: 11 }}
              >Remove</button>
            </div>

            <input
              value={p.description}
              onChange={e => updatePart(i, { description: e.target.value })}
              placeholder={p.role === 'worker' ? "Short description shown to orchestrator (e.g. 'Python 3, async, typing')" : "Description (optional)"}
              style={inputStyle}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Provider</label>
                <select
                  value={p.provider_id}
                  onChange={e => updatePart(i, { provider_id: e.target.value, model: '' })}
                  style={inputStyle}
                >
                  <option value="">Select…</option>
                  {providers.map(prov => (<option key={prov.id} value={prov.id}>{prov.name}</option>))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Model</label>
                <select
                  value={p.model}
                  onChange={e => updatePart(i, { model: e.target.value })}
                  disabled={!p.provider_id}
                  style={inputStyle}
                >
                  <option value="">Select…</option>
                  {(modelsByProvider[p.provider_id] || []).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Context</label>
                <select
                  value={p.context_mode}
                  onChange={e => updatePart(i, { context_mode: e.target.value as any })}
                  style={inputStyle}
                >
                  <option value="full">Full transcript</option>
                  <option value="last_n">Last N messages</option>
                  <option value="question_only">Question only</option>
                </select>
              </div>
              {p.context_mode === 'last_n' && (
                <div style={{ width: 80 }}>
                  <label style={labelStyle}>N</label>
                  <input
                    type="number" min={1} max={50}
                    value={p.context_last_n}
                    onChange={e => updatePart(i, { context_last_n: parseInt(e.target.value) || 1 })}
                    style={inputStyle}
                  />
                </div>
              )}
            </div>

            <label style={labelStyle}>System prompt (optional)</label>
            <textarea
              value={p.system_prompt}
              onChange={e => updatePart(i, { system_prompt: e.target.value })}
              placeholder={p.role === 'orchestrator' ? "How the orchestrator should behave. Roster is injected automatically." : "The worker's persona / expertise."}
              style={{ ...inputStyle, minHeight: 48, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => addParticipant('orchestrator')}
            disabled={hasOrchestrator}
            style={{
              padding: '6px 12px', background: 'transparent',
              color: hasOrchestrator ? '#555' : ACCENT,
              border: `1px dashed ${hasOrchestrator ? '#333' : ACCENT}`, borderRadius: 6,
              cursor: hasOrchestrator ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >+ Orchestrator</button>
          <button
            onClick={() => addParticipant('worker')}
            style={{
              padding: '6px 12px', background: 'transparent', color: '#4fc3f7',
              border: '1px dashed #4fc3f7', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >+ Worker</button>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
          >Cancel</button>
          <button
            onClick={() => canSave && onSave({
              participants,
              max_turns: maxTurns,
              termination_rule: termination || null,
              initial_prompt: initialPrompt,
              output_mode: outputMode,
            })}
            disabled={!canSave}
            style={{
              padding: '8px 16px', background: canSave ? ACCENT : '#333',
              color: canSave ? '#000' : '#666', border: 'none', borderRadius: 6,
              fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed', fontSize: 13,
            }}
          >Save</button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', marginBottom: 10,
  background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
  borderRadius: 6, fontSize: 12, boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#888', display: 'block', marginBottom: 4,
}
