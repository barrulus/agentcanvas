import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  type Connection as XYConnection,
} from '@xyflow/react'
import { RootState, AppDispatch } from '@/shared/state/store'
import {
  debouncedSaveLayout,
  removeConnection,
  updateConnectionContract,
  setSelected,
  removeCard,
} from '@/shared/state/canvasSlice'
import { removeSession } from '@/shared/state/agentsSlice'
import { getCanvasPrefs } from '@/shared/prefs'
import { nodeTypes } from './xyflow/nodes'
import { edgeTypes } from './xyflow/edges'
import { NodeInspectorPanel } from './NodeInspectorPanel'
import { UpstreamPicker, type UpstreamNode } from './upstreamPicker'
import {
  selectNodes,
  selectEdges,
  applyNodesChange,
  applyEdgesChange,
  onConnect as adapterOnConnect,
  onReconnect as adapterOnReconnect,
} from './xyflow/adapters'

function CanvasInner() {
  const dispatch = useDispatch<AppDispatch>()
  const canvasState = useSelector((s: RootState) => s.canvas)
  const { cards, connections, groups, currentDashboardId, constraints, selectedCards } = canvasState

  const activeRunId = useSelector((s: RootState) => s.runs.activeRunId)
  const activeRun = useSelector((s: RootState) => activeRunId ? s.runs.byId[activeRunId] : null)
  const reduxNodes = useMemo(() => selectNodes(canvasState, activeRun), [canvasState, activeRun])
  const reduxEdges = useMemo(() => selectEdges(canvasState, activeRun), [canvasState, activeRun])
  // Local state mirrors Redux but absorbs in-flight drag changes for smooth visuals.
  // Redux is the source of truth — synced from it whenever it changes.
  const [nodes, setNodes] = useState(reduxNodes)
  const [edges, setEdges] = useState(reduxEdges)
  useEffect(() => setNodes(reduxNodes), [reduxNodes])
  useEffect(() => setEdges(reduxEdges), [reduxEdges])

  const inspectedSessionId = selectedCards.length === 1 ? selectedCards[0] : null

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; connId: string } | null>(null)
  const [editingConn, setEditingConn] = useState<{
    connId: string
    condition: string
    outputSchema: string
    transform: string
    gateRule: string
  } | null>(null)

  const transformRef = useRef<HTMLTextAreaElement | null>(null)

  const sessions = useSelector((s: RootState) => s.agents.sessions)

  const immediateUpstream = useMemo<UpstreamNode | null>(() => {
    if (!editingConn) return null
    const conn = connections.find((c) => c.id === editingConn.connId)
    if (!conn) return null
    const name = sessions[conn.from]?.name
    if (!name) return null
    return { id: conn.from, name }
  }, [editingConn, connections, sessions])

  const [prefs, setPrefsState] = useState(getCanvasPrefs())
  useEffect(() => {
    const onChange = () => setPrefsState(getCanvasPrefs())
    window.addEventListener('agentcanvas:prefs-changed', onChange)
    return () => window.removeEventListener('agentcanvas:prefs-changed', onChange)
  }, [])

  // Persist layout (debounced)
  useEffect(() => {
    if (Object.keys(cards).length > 0 || connections.length > 0 || Object.keys(groups).length > 0 || constraints) {
      debouncedSaveLayout(currentDashboardId, cards, connections, groups, constraints)
    }
  }, [cards, connections, groups, constraints, currentDashboardId])

  // Delete/Backspace removes all selected cards (xyflow's deleteKeyCode would only call onNodesChange; we want full session cleanup)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (selectedCards.length === 0) return
      e.preventDefault()
      for (const id of selectedCards) {
        dispatch(removeCard(id))
        dispatch(removeSession(id))
        fetch(`/api/sessions/${id}`, { method: 'DELETE' }).catch(() => {})
      }
      dispatch(setSelected([]))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedCards, dispatch])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns) as typeof ns)
      applyNodesChange(dispatch, changes)
    },
    [dispatch],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => applyEdgeChanges(changes, es) as typeof es)
      applyEdgesChange(dispatch, changes)
    },
    [dispatch],
  )
  const onConnect = useCallback(
    (conn: XYConnection) => adapterOnConnect(dispatch, conn),
    [dispatch],
  )
  const onReconnect = useCallback(
    (oldEdge: { id: string }, conn: XYConnection) => adapterOnReconnect(dispatch, oldEdge, conn),
    [dispatch],
  )
  const onPaneClick = useCallback(() => {
    if (selectedCards.length > 0) dispatch(setSelected([]))
    setContextMenu(null)
  }, [selectedCards.length, dispatch])

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: { id: string }) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, connId: edge.id })
  }, [])

  const handleDeleteConnection = useCallback(() => {
    if (contextMenu) {
      dispatch(removeConnection(contextMenu.connId))
      setContextMenu(null)
    }
  }, [contextMenu, dispatch])

  const handleEditContract = useCallback(() => {
    if (!contextMenu) return
    const conn = connections.find((c) => c.id === contextMenu.connId)
    setEditingConn({
      connId: contextMenu.connId,
      condition: conn?.condition || '',
      outputSchema: conn?.output_schema ? JSON.stringify(conn.output_schema, null, 2) : '',
      transform: conn?.transform || '',
      gateRule: conn?.gate_rule || '',
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
    dispatch(
      updateConnectionContract({
        id: editingConn.connId,
        condition: editingConn.condition || undefined,
        output_schema: parsedSchema,
        transform: editingConn.transform || undefined,
        gate_rule: editingConn.gateRule || undefined,
      }),
    )
    setEditingConn(null)
  }, [editingConn, dispatch])

  return (
    <div style={{ flex: 1, position: 'relative', background: '#0a0a0f' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onPaneClick={onPaneClick}
        onEdgeContextMenu={onEdgeContextMenu}
        panOnScroll
        panOnScrollSpeed={prefs.zoomSensitivity}
        zoomOnPinch
        zoomOnScroll={false}
        zoomActivationKeyCode="Alt"
        selectionOnDrag
        panOnDrag={[1, 2]}
        minZoom={0.15}
        maxZoom={3}
        snapToGrid
        snapGrid={[prefs.gridSize, prefs.gridSize]}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        fitView={Object.keys(cards).length > 0}
      >
        <Background variant={BackgroundVariant.Dots} gap={prefs.gridSize} size={1} color="rgba(255,255,255,0.08)" />
        <Controls />
        <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.6)" nodeColor="#1a1a2e" />
      </ReactFlow>

      {/* Node inspector — opens when a single card is selected */}
      {inspectedSessionId && (
        <NodeInspectorPanel
          sessionId={inspectedSessionId}
          onClose={() => dispatch(setSelected([]))}
        />
      )}

      {/* Edge context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: '#1a1a2e',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 4,
            zIndex: 100000,
            minWidth: 140,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={handleEditContract} style={ctxMenuItemStyle}>
            Edit data contract...
          </button>
          <button onClick={handleDeleteConnection} style={{ ...ctxMenuItemStyle, color: '#ef5350' }}>
            Delete connection
          </button>
        </div>
      )}

      {/* Contract editor modal */}
      {editingConn && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100001,
          }}
          onClick={() => setEditingConn(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#1a1a2e', borderRadius: 12, padding: 24, width: 480, border: '1px solid #333' }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#e0e0e0' }}>Connection Data Contract</h3>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>
              Routing condition
              <span style={{ color: '#555', fontWeight: 400 }}> — e.g. contains:error, regex:SUCCESS</span>
            </label>
            <input
              value={editingConn.condition}
              onChange={(e) => setEditingConn((c) => (c ? { ...c, condition: e.target.value } : c))}
              placeholder="Empty = always route"
              style={inputStyle}
            />
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>
              Output schema (JSON Schema)
              <span style={{ color: '#555', fontWeight: 400 }}> — validates output before routing</span>
            </label>
            <textarea
              value={editingConn.outputSchema}
              onChange={(e) => setEditingConn((c) => (c ? { ...c, outputSchema: e.target.value } : c))}
              placeholder='{"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}}'
              style={textareaStyle}
            />
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>
              Transform template
              <span style={{ color: '#555', fontWeight: 400 }}>{' — {{output}}, {{output.field}}, {{nodes.<Name>.output[.field]}}'}</span>
            </label>
            <UpstreamPicker
              upstream={immediateUpstream}
              onInsert={(snippet) => {
                const ta = transformRef.current
                const current = editingConn.transform || ''
                if (!ta) {
                  setEditingConn((c) => (c ? { ...c, transform: current + snippet } : c))
                  return
                }
                const start = ta.selectionStart ?? current.length
                const end = ta.selectionEnd ?? current.length
                const next = current.slice(0, start) + snippet + current.slice(end)
                setEditingConn((c) => (c ? { ...c, transform: next } : c))
                requestAnimationFrame(() => {
                  ta.focus()
                  const pos = start + snippet.length
                  ta.setSelectionRange(pos, pos)
                })
              }}
            />
            <textarea
              ref={transformRef}
              value={editingConn.transform}
              onChange={(e) => setEditingConn((c) => (c ? { ...c, transform: e.target.value } : c))}
              placeholder="{{output.summary}}"
              style={{ ...textareaStyle, minHeight: 48 }}
            />
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>
              Gate rule (circuit breaker)
              <span style={{ color: '#555', fontWeight: 400 }}> — halts routing if output fails check</span>
            </label>
            <input
              value={editingConn.gateRule}
              onChange={(e) => setEditingConn((c) => (c ? { ...c, gateRule: e.target.value } : c))}
              placeholder="require:approved, reject:error, min_length:100, max_length:5000"
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditingConn(null)}
                style={{
                  padding: '8px 16px',
                  background: 'transparent',
                  color: '#888',
                  border: '1px solid #333',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveContract}
                style={{
                  padding: '8px 16px',
                  background: '#4fc3f7',
                  color: '#000',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 13,
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

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}

const ctxMenuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 12px',
  background: 'transparent',
  color: '#ccc',
  border: 'none',
  fontSize: 12,
  cursor: 'pointer',
  textAlign: 'left',
  borderRadius: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  marginBottom: 12,
  background: '#12121e',
  color: '#e0e0e0',
  border: '1px solid #333',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  marginBottom: 12,
  background: '#12121e',
  color: '#e0e0e0',
  border: '1px solid #333',
  borderRadius: 6,
  fontSize: 12,
  minHeight: 80,
  resize: 'vertical',
  fontFamily: 'monospace',
  boxSizing: 'border-box',
}
