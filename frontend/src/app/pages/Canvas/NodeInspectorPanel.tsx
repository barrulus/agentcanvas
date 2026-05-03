import { useState, useEffect, useMemo } from 'react'
import { useSelector } from 'react-redux'
import type { RootState } from '@/shared/state/store'

type LastRun = {
  session_id: string
  status: 'idle' | 'running' | 'completed' | 'error' | 'stopped'
  started_at: number | null
  ended_at: number | null
  duration_ms: number | null
  prompt_in: string | null
  response_out: string
  error_text: string | null
  tokens: { input?: number; output?: number }
  cost_usd: number
  tool_calls: Array<{
    tool_name?: string
    tool_call_id?: string
    args: unknown
    result: unknown
    started_at: number | null
    ended_at: number | null
  }>
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#666',
  running: '#4fc3f7',
  completed: '#66bb6a',
  error: '#ef5350',
  stopped: '#ffa726',
}

type Tab = 'input' | 'output' | 'errors' | 'cost' | 'tools'

export function NodeInspectorPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const session = useSelector((s: RootState) => s.agents.sessions[sessionId])
  const card = useSelector((s: RootState) => s.canvas.cards[sessionId])
  const cardType = card?.card_type ?? 'agent'

  const [run, setRun] = useState<LastRun | null>(null)
  const [tab, setTab] = useState<Tab>('input')
  const [loading, setLoading] = useState(false)

  // Fetch last-run when selection changes or session status flips.
  // Status comes from Redux (driven by agent:status WS events) so this auto-refreshes mid-run.
  const status = session?.status
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/sessions/${sessionId}/last-run`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled) setRun(data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [sessionId, status])

  const availableTabs = useMemo<Tab[]>(() => {
    if (cardType === 'view' || cardType === 'input') return ['input', 'output']
    return ['input', 'output', 'errors', 'cost', 'tools']
  }, [cardType])

  useEffect(() => {
    if (!availableTabs.includes(tab)) setTab(availableTabs[0])
  }, [availableTabs, tab])

  const statusColor = STATUS_COLORS[run?.status ?? 'idle']
  const title = session?.name || card?.session_id?.slice(0, 8) || 'Node'

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        background: '#12121e',
        borderLeft: '1px solid #2a2a3e',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
      }}
    >
      <div style={headerStyle}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusColor,
            boxShadow: run?.status === 'running' ? `0 0 8px ${statusColor}` : 'none',
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase' }}>
            {cardType} · {run?.status ?? 'idle'}
            {run?.duration_ms != null && ` · ${formatDuration(run.duration_ms)}`}
          </div>
        </div>
        <button onClick={onClose} style={closeBtnStyle} title="Close">
          ×
        </button>
      </div>

      <div style={tabBarStyle}>
        {availableTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...tabBtnStyle, ...(tab === t ? tabBtnActiveStyle : {}) }}
          >
            {tabLabel(t)}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {loading && !run && <Empty>Loading…</Empty>}
        {!loading && !run && <Empty>No run data.</Empty>}
        {run && tab === 'input' && <InputTab run={run} />}
        {run && tab === 'output' && <OutputTab run={run} />}
        {run && tab === 'errors' && <ErrorsTab run={run} />}
        {run && tab === 'cost' && <CostTab run={run} />}
        {run && tab === 'tools' && <ToolsTab run={run} />}
      </div>
    </div>
  )
}

function tabLabel(t: Tab): string {
  return { input: 'Input', output: 'Output', errors: 'Errors', cost: 'Cost', tools: 'Tools' }[t]
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

function InputTab({ run }: { run: LastRun }) {
  if (!run.prompt_in) return <Empty>No input yet.</Empty>
  return (
    <Section label="Resolved prompt">
      <pre style={preStyle}>{run.prompt_in}</pre>
    </Section>
  )
}

function OutputTab({ run }: { run: LastRun }) {
  if (!run.response_out) return <Empty>No output yet.</Empty>
  let parsed: unknown = null
  try {
    parsed = JSON.parse(run.response_out)
  } catch {
    /* not JSON, that's fine */
  }
  return (
    <>
      <Section label="Raw">
        <pre style={preStyle}>{run.response_out}</pre>
      </Section>
      {parsed !== null && typeof parsed === 'object' && (
        <Section label="Parsed JSON">
          <pre style={preStyle}>{JSON.stringify(parsed, null, 2)}</pre>
        </Section>
      )}
    </>
  )
}

function ErrorsTab({ run }: { run: LastRun }) {
  if (run.status !== 'error' && !run.error_text) {
    return <Empty>No errors on the most recent run.</Empty>
  }
  return (
    <Section label="Error">
      <pre style={{ ...preStyle, color: '#ef5350' }}>{run.error_text || '(no detail)'}</pre>
    </Section>
  )
}

function CostTab({ run }: { run: LastRun }) {
  return (
    <>
      <Section label="Cost (cumulative session)">
        <div style={statRow}>
          <span style={statLabel}>Total</span>
          <span style={statValue}>${run.cost_usd.toFixed(4)}</span>
        </div>
      </Section>
      <Section label="Tokens (cumulative session)">
        <div style={statRow}>
          <span style={statLabel}>Input</span>
          <span style={statValue}>{(run.tokens.input ?? 0).toLocaleString()}</span>
        </div>
        <div style={statRow}>
          <span style={statLabel}>Output</span>
          <span style={statValue}>{(run.tokens.output ?? 0).toLocaleString()}</span>
        </div>
      </Section>
    </>
  )
}

function ToolsTab({ run }: { run: LastRun }) {
  if (run.tool_calls.length === 0) return <Empty>No tool calls on this run.</Empty>
  return (
    <>
      {run.tool_calls.map((tc, i) => {
        const dur = tc.started_at && tc.ended_at ? formatDuration(Math.round((tc.ended_at - tc.started_at) * 1000)) : null
        return (
          <Section key={i} label={`${tc.tool_name || 'tool'}${dur ? ` · ${dur}` : ''}`}>
            {tc.args !== null && tc.args !== undefined && (
              <>
                <div style={subLabelStyle}>args</div>
                <pre style={preStyle}>{stringify(tc.args)}</pre>
              </>
            )}
            {tc.result !== null && tc.result !== undefined && (
              <>
                <div style={subLabelStyle}>result</div>
                <pre style={preStyle}>{stringify(tc.result)}</pre>
              </>
            )}
          </Section>
        )
      })}
    </>
  )
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={sectionLabelStyle}>{label}</div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#666', fontSize: 12, fontStyle: 'italic', padding: 12 }}>{children}</div>
}

const headerStyle: React.CSSProperties = {
  padding: '12px 14px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  borderBottom: '1px solid #2a2a3e',
  background: '#16162a',
}

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#888',
  fontSize: 20,
  cursor: 'pointer',
  width: 24,
  height: 24,
  lineHeight: 1,
  borderRadius: 4,
}

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid #2a2a3e',
  background: '#0f0f17',
}

const tabBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 4px',
  background: 'transparent',
  color: '#888',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

const tabBtnActiveStyle: React.CSSProperties = {
  color: '#4fc3f7',
  borderBottomColor: '#4fc3f7',
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#888',
  marginBottom: 6,
  fontWeight: 600,
}

const subLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  marginTop: 8,
  marginBottom: 4,
}

const preStyle: React.CSSProperties = {
  background: '#0a0a0f',
  border: '1px solid #2a2a3e',
  borderRadius: 6,
  padding: 10,
  fontSize: 12,
  color: '#cfd8dc',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 320,
  overflow: 'auto',
  margin: 0,
}

const statRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '6px 10px',
  background: '#0a0a0f',
  borderRadius: 4,
  marginBottom: 4,
}

const statLabel: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
}

const statValue: React.CSSProperties = {
  fontSize: 12,
  color: '#e0e0e0',
  fontFamily: 'monospace',
}
