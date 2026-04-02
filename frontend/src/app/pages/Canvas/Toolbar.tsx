import { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { AppDispatch, RootState } from '@/shared/state/store'
import { createSession, fetchProviders, fetchSessions } from '@/shared/state/agentsSlice'
import { placeCard, loadLayout, addConnection, fetchDashboards, createDashboard, switchDashboard } from '@/shared/state/canvasSlice'
import { wsManager } from '@/shared/ws/WebSocketManager'

interface ToolbarProps {
  onOpenSettings?: () => void
  onOpenHistory?: () => void
  showDialog?: boolean
  setShowDialog?: (v: boolean) => void
}

export function Toolbar({ onOpenSettings, onOpenHistory, showDialog: showDialogProp, setShowDialog: setShowDialogProp }: ToolbarProps) {
  const dispatch = useDispatch<AppDispatch>()
  const providers = useSelector((s: RootState) => s.agents.providers)
  const sessions = useSelector((s: RootState) => s.agents.sessions)
  const dashboards = useSelector((s: RootState) => s.canvas.dashboards)
  const currentDashboardId = useSelector((s: RootState) => s.canvas.currentDashboardId)
  const [showDialogInternal, setShowDialogInternal] = useState(false)
  const showDialog = showDialogProp ?? showDialogInternal
  const setShowDialog = setShowDialogProp ?? setShowDialogInternal
  const [selectedProvider, setSelectedProvider] = useState('')
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    dispatch(fetchProviders())
    wsManager.connect()

    // Load dashboards, then load layout + sessions for current dashboard
    dispatch(fetchDashboards()).then((result) => {
      const dbs = result.payload as Array<{ id: string; name: string; card_count: number; created_at: number }>
      if (!dbs || dbs.length === 0) {
        // Create a default dashboard if none exist
        dispatch(createDashboard('Default')).then(() => {
          dispatch(loadLayout('default'))
          dispatch(fetchSessions('default'))
        })
      } else {
        dispatch(loadLayout(currentDashboardId))
        dispatch(fetchSessions(currentDashboardId))
      }
    })
  }, [dispatch])

  // Rebuild connections from parent_session_id whenever sessions change
  useEffect(() => {
    for (const s of Object.values(sessions)) {
      if (s.parent_session_id) {
        dispatch(addConnection({ from: s.parent_session_id, to: s.id }))
      }
    }
  }, [sessions, dispatch])

  const handleProviderChange = async (providerId: string) => {
    setSelectedProvider(providerId)
    const res = await fetch(`/api/providers/${providerId}/models`)
    const data = await res.json()
    setModels(data.models)
    if (data.models.length > 0) setSelectedModel(data.models[0].id)
  }

  const handleCreate = async () => {
    if (!selectedProvider || !selectedModel || !prompt.trim()) return
    const result = await dispatch(createSession({
      provider_id: selectedProvider,
      model: selectedModel,
      dashboard_id: currentDashboardId,
    } as any)).unwrap()

    dispatch(placeCard({ sessionId: result.id }))
    wsManager.sendMessage(result.id, prompt)

    setShowDialog(false)
    setPrompt('')
  }

  const handleSwitchDashboard = (dashboardId: string) => {
    if (dashboardId === currentDashboardId) return
    dispatch(switchDashboard(dashboardId))
    dispatch(loadLayout(dashboardId))
    dispatch(fetchSessions(dashboardId))
  }

  const handleNewDashboard = async () => {
    const name = window.prompt('Dashboard name:')
    if (!name?.trim()) return
    const result = await dispatch(createDashboard(name.trim())).unwrap()
    handleSwitchDashboard(result.id)
  }

  return (
    <div style={{
      height: 48,
      background: '#12121e',
      borderBottom: '1px solid #222',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 12,
      flexShrink: 0,
    }}>
      <span style={{ fontWeight: 700, fontSize: 15, color: '#e0e0e0', letterSpacing: -0.5 }}>
        AgentCanvas
      </span>

      {/* Dashboard tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 12 }}>
        {dashboards.map(db => (
          <button
            key={db.id}
            onClick={() => handleSwitchDashboard(db.id)}
            style={{
              padding: '4px 10px',
              background: 'transparent',
              color: db.id === currentDashboardId ? '#e0e0e0' : '#666',
              border: 'none',
              borderBottom: db.id === currentDashboardId ? '2px solid #4fc3f7' : '2px solid transparent',
              borderRadius: 0,
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: db.id === currentDashboardId ? 600 : 400,
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {db.name}
          </button>
        ))}
        <button
          onClick={handleNewDashboard}
          style={{
            padding: '4px 6px',
            background: 'transparent',
            color: '#555',
            border: '1px solid #333',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
            lineHeight: 1,
            marginLeft: 4,
          }}
          title="New dashboard"
        >
          +
        </button>
      </div>

      <span style={{ flex: 1 }} />

      <button
        onClick={onOpenHistory}
        style={{
          padding: '6px 12px',
          background: 'transparent',
          color: '#888',
          border: '1px solid #333',
          borderRadius: 6,
          fontSize: 15,
          cursor: 'pointer',
          lineHeight: 1,
        }}
        title="Session history"
      >
        &#128339;
      </button>

      <button
        onClick={onOpenSettings}
        style={{
          padding: '6px 12px',
          background: 'transparent',
          color: '#888',
          border: '1px solid #333',
          borderRadius: 6,
          fontSize: 16,
          cursor: 'pointer',
          lineHeight: 1,
        }}
        title="Settings"
      >
        ⚙
      </button>

      <button
        onClick={() => setShowDialog(true)}
        style={{
          padding: '6px 16px',
          background: '#4fc3f7',
          color: '#000',
          border: 'none',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        + New Agent
      </button>

      {/* Dialog */}
      {showDialog && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }} onClick={() => setShowDialog(false)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#1a1a2e', borderRadius: 12, padding: 24,
              width: 420, border: '1px solid #333',
            }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>New Agent</h3>

            {/* Provider select */}
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Provider</label>
            <select
              value={selectedProvider}
              onChange={e => handleProviderChange(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', marginBottom: 12,
                background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                borderRadius: 6, fontSize: 13,
              }}
            >
              <option value="">Select provider...</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {/* Model select */}
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Model</label>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', marginBottom: 12,
                background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                borderRadius: 6, fontSize: 13,
              }}
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>

            {/* Prompt */}
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Initial message</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="What should this agent do?"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCreate() }}}
              style={{
                width: '100%', padding: '8px 12px', marginBottom: 16,
                background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                borderRadius: 6, fontSize: 13, minHeight: 80, resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDialog(false)}
                style={{
                  padding: '8px 16px', background: 'transparent', color: '#888',
                  border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!selectedProvider || !selectedModel || !prompt.trim()}
                style={{
                  padding: '8px 16px', background: '#4fc3f7', color: '#000',
                  border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13,
                  opacity: (!selectedProvider || !selectedModel || !prompt.trim()) ? 0.4 : 1,
                }}
              >
                Create & Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
