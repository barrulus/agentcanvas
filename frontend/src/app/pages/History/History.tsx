import { useState, useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { fetchHistory, fetchSessions } from '@/shared/state/agentsSlice'
import { placeCard } from '@/shared/state/canvasSlice'

function relativeTime(ts: number): string {
  const now = Date.now()
  const diff = now - ts * 1000
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function History({ onClose }: { onClose: () => void }) {
  const dispatch = useDispatch<AppDispatch>()
  const history = useSelector((s: RootState) => s.agents.history)
  const currentDashboardId = useSelector((s: RootState) => s.canvas.currentDashboardId)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch(fetchHistory(search || undefined))
    }, 300)
    return () => clearTimeout(timer)
  }, [search, dispatch])

  const handleReopen = async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}/reopen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dashboard_id: currentDashboardId }),
    })
    if (res.ok) {
      dispatch(placeCard({ sessionId }))
      dispatch(fetchSessions(currentDashboardId))
      dispatch(fetchHistory(search || undefined))
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 10000,
      display: 'flex',
      justifyContent: 'flex-end',
    }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'relative',
        width: 400,
        height: '100%',
        background: '#12121e',
        borderLeft: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #222',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#e0e0e0' }}>
            Session History
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            &times;
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '12px 20px', flexShrink: 0 }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search sessions..."
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#1a1a2e',
              color: '#e0e0e0',
              border: '1px solid #333',
              borderRadius: 6,
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 20px' }}>
          {history.length === 0 && (
            <div style={{ color: '#555', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              No closed sessions found
            </div>
          )}
          {history.map(session => {
            const isExpanded = expandedId === session.id
            const lastMessages = session.messages?.slice(-3) || []

            return (
              <div
                key={session.id}
                style={{
                  background: '#1a1a2e',
                  borderRadius: 8,
                  border: '1px solid #2a2a3e',
                  marginBottom: 8,
                  overflow: 'hidden',
                }}
              >
                {/* Session header */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : session.id)}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#ccc', flex: 1 }}>
                      {session.name || 'Agent'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleReopen(session.id)
                      }}
                      style={{
                        padding: '3px 10px',
                        background: '#1a6fb5',
                        color: '#e0e0e0',
                        border: 'none',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Reopen
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 10,
                      color: '#999',
                      background: '#222',
                      padding: '1px 6px',
                      borderRadius: 3,
                    }}>
                      {session.provider_id}
                    </span>
                    <span style={{ fontSize: 10, color: '#666' }}>
                      {session.model}
                    </span>
                    <span style={{ fontSize: 10, color: '#555' }}>
                      {session.messages?.length || 0} msgs
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: '#555' }}>
                      {session.created_at ? relativeTime(session.created_at) : ''}
                    </span>
                  </div>
                </div>

                {/* Expanded: show last messages */}
                {isExpanded && lastMessages.length > 0 && (
                  <div style={{
                    borderTop: '1px solid #2a2a3e',
                    padding: '8px 12px',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}>
                    {lastMessages.map((msg, i) => (
                      <div key={i} style={{
                        fontSize: 11,
                        color: msg.role === 'user' ? '#4fc3f7' : '#999',
                        marginBottom: 4,
                        lineHeight: 1.4,
                      }}>
                        <span style={{ fontWeight: 600, marginRight: 4 }}>
                          {msg.role === 'user' ? 'You:' : 'Agent:'}
                        </span>
                        {typeof msg.content === 'string'
                          ? msg.content.slice(0, 200)
                          : JSON.stringify(msg.content).slice(0, 200)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
