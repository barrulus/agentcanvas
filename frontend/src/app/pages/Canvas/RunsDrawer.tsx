import { useState, useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { fetchRuns, setActiveRun, WorkflowRun, CardRunRecord } from '@/shared/state/runsSlice'

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

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = (seconds - m * 60).toFixed(0)
  return `${m}m${s}s`
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString()
}

const STATUS_COLORS: Record<WorkflowRun['status'], string> = {
  running: '#4fc3f7',
  completed: '#66bb6a',
  error: '#ef5350',
  interrupted: '#888',
}

const CARD_STATUS_COLORS: Record<CardRunRecord['status'], string> = {
  running: '#4fc3f7',
  completed: '#66bb6a',
  error: '#ef5350',
  stopped: '#ffa726',
}

function useLiveName(cardId: string, fallback: string): string {
  return useSelector((s: RootState) => {
    return s.agents.sessions[cardId]?.name
      ?? s.gateCards.cards[cardId]?.name
      ?? s.dialogueCards.cards[cardId]?.name
      ?? s.mergeCards.cards[cardId]?.name
      ?? s.viewCards.cards[cardId]?.name
      ?? s.inputCards.cards[cardId]?.name
      ?? null
  }) ?? fallback
}

function RunRow({ run, isActive, onClick }: {
  run: WorkflowRun
  isActive: boolean
  onClick: () => void
}) {
  const dispatch = useDispatch<AppDispatch>()
  const liveName = useLiveName(run.trigger_card_id, run.trigger_card_name)
  const duration = run.ended_at != null ? run.ended_at - run.started_at : null

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={onClick}
        style={{
          background: isActive ? '#1a2a3e' : '#1a1a2e',
          borderRadius: 8,
          border: isActive ? '1px solid #1a6fb5' : '1px solid #2a2a3e',
          padding: '10px 12px',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: STATUS_COLORS[run.status],
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 12, color: '#aaa', flex: 1 }}>
            {relativeTime(run.started_at)} · {run.trigger} · {formatDuration(duration)} · ${run.total_cost_usd.toFixed(3)}
          </span>
        </div>
        <div style={{ marginTop: 4, paddingLeft: 16, fontSize: 12, color: '#666' }}>
          {liveName} · {formatTime(run.started_at)}
        </div>
      </div>

      {isActive && (
        <RunDetail run={run} liveName={liveName} onReturnToLive={() => dispatch(setActiveRun(null))} />
      )}
    </div>
  )
}

function CardRunRow({ cr }: { cr: CardRunRecord }) {
  const liveName = useLiveName(cr.card_id, cr.card_name)
  const duration = cr.ended_at != null ? cr.ended_at - cr.started_at : null

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: CARD_STATUS_COLORS[cr.status],
        flexShrink: 0,
        marginTop: 3,
      }} />
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 11, color: '#ccc' }}>
          {liveName}
        </span>
        <span style={{ fontSize: 11, color: '#555', marginLeft: 4 }}>
          ({cr.card_type})
        </span>
        <span style={{ fontSize: 11, color: '#666', marginLeft: 6 }}>
          {formatDuration(duration)} · ${cr.cost_usd.toFixed(3)}
        </span>
        {cr.error_text && (
          <div style={{ fontSize: 10, color: '#ef5350', marginTop: 2 }}>
            {cr.error_text}
          </div>
        )}
      </div>
    </div>
  )
}

function RunDetail({ run, liveName: _liveName, onReturnToLive }: {
  run: WorkflowRun
  liveName: string
  onReturnToLive: () => void
}) {
  const duration = run.ended_at != null ? run.ended_at - run.started_at : null

  return (
    <div style={{
      background: '#111122',
      border: '1px solid #1a6fb5',
      borderTop: 'none',
      borderRadius: '0 0 8px 8px',
      padding: '10px 12px',
    }}>
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        Total: {formatDuration(duration)} · ${run.total_cost_usd.toFixed(3)} · {run.total_tokens} tok
      </div>

      {run.card_runs.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
            Cards ({run.card_runs.length}):
          </div>
          {run.card_runs.map((cr, i) => (
            <CardRunRow key={i} cr={cr} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          disabled
          title="Available after card-definition split (Phase F)"
          style={{
            padding: '5px 12px',
            background: '#1a1a2e',
            color: '#555',
            border: '1px solid #333',
            borderRadius: 4,
            fontSize: 11,
            cursor: 'not-allowed',
          }}
        >
          Replay
        </button>
        <button
          onClick={onReturnToLive}
          style={{
            padding: '5px 12px',
            background: '#1a6fb5',
            color: '#e0e0e0',
            border: 'none',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Return to live
        </button>
      </div>
    </div>
  )
}

export function RunsDrawer({ onClose }: { onClose: () => void }) {
  const dispatch = useDispatch<AppDispatch>()
  const currentDashboardId = useSelector((s: RootState) => s.canvas.currentDashboardId)
  const byId = useSelector((s: RootState) => s.runs.byId)
  const orderByDashboard = useSelector((s: RootState) => s.runs.orderByDashboard)
  const activeRunId = useSelector((s: RootState) => s.runs.activeRunId)
  const [hasMore, setHasMore] = useState(true)

  useEffect(() => {
    if (!currentDashboardId) return
    dispatch(fetchRuns({ dashboardId: currentDashboardId })).then((action) => {
      if (fetchRuns.fulfilled.match(action)) {
        if (action.payload.runs.length < 50) setHasMore(false)
        else setHasMore(true)
      }
    })
  }, [currentDashboardId, dispatch])

  const runIds = currentDashboardId ? (orderByDashboard[currentDashboardId] ?? []) : []
  const runs = runIds.map(id => byId[id]).filter(Boolean)

  const handleLoadMore = () => {
    if (!currentDashboardId) return
    dispatch(fetchRuns({ dashboardId: currentDashboardId, offset: runIds.length })).then((action) => {
      if (fetchRuns.fulfilled.match(action)) {
        if (action.payload.runs.length < 50) setHasMore(false)
      }
    })
  }

  const handleRowClick = (runId: string) => {
    if (activeRunId === runId) {
      dispatch(setActiveRun(null))
    } else {
      dispatch(setActiveRun(runId))
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
            Runs
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

        {/* Run list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px 20px' }}>
          {runs.length === 0 && (
            <div style={{ color: '#555', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              No runs found
            </div>
          )}

          {runs.map(run => (
            <RunRow
              key={run.id}
              run={run}
              isActive={activeRunId === run.id}
              onClick={() => handleRowClick(run.id)}
            />
          ))}

          {hasMore && runs.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <button
                onClick={handleLoadMore}
                style={{
                  padding: '6px 20px',
                  background: '#1a1a2e',
                  color: '#aaa',
                  border: '1px solid #333',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Load more
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
