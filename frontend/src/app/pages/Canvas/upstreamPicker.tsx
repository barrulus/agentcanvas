import { useEffect, useMemo, useState } from 'react'

export type UpstreamNode = { id: string; name: string }

type LastRun = { response_out?: string | null }

function discoverPaths(json: unknown, prefix = '', depth = 0): string[] {
  if (depth > 3 || json === null || typeof json !== 'object' || Array.isArray(json)) return []
  return Object.entries(json as Record<string, unknown>).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k
    return [path, ...discoverPaths(v, path, depth + 1)]
  }).slice(0, 20)
}

function parseJsonLoose(text: string | null | undefined): unknown {
  if (!text) return null
  try {
    return JSON.parse(text.trim())
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}

export function UpstreamPicker({
  upstream,
  onInsert,
}: {
  upstream: UpstreamNode | null
  onInsert: (snippet: string) => void
}) {
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!upstream) { setLastRun(null); setError(null); return }
    let cancelled = false
    setError(null)
    fetch(`/api/sessions/${upstream.id}/last-run`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => { if (!cancelled) setLastRun(data) })
      .catch((e) => { if (!cancelled) { setLastRun(null); setError(String(e?.message ?? e)) } })
    return () => { cancelled = true }
  }, [upstream?.id])

  const paths = useMemo(() => {
    const parsed = parseJsonLoose(lastRun?.response_out ?? null)
    return discoverPaths(parsed)
  }, [lastRun])

  if (!upstream) return null

  return (
    <div style={{ marginBottom: 8, padding: 8, background: '#13132a', borderRadius: 6, border: '1px solid #2a2a44' }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
        Insert from <span style={{ color: '#9fd9ff', fontFamily: 'monospace' }}>{upstream.name}</span>:
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <button type="button" onClick={() => onInsert('{{output}}')} style={chipStyle} title="Insert full text">
          output
        </button>
        {paths.map((p) => (
          <button key={p} type="button" onClick={() => onInsert(`{{output.${p}}}`)} style={chipStyle} title={`Insert ${p}`}>
            {p}
          </button>
        ))}
        {paths.length === 0 && lastRun && (
          <span style={{ fontSize: 11, color: '#666' }}>No JSON fields detected in last output. Run the upstream once to populate.</span>
        )}
        {error && <span style={{ fontSize: 11, color: '#888' }}>Couldn't load output preview.</span>}
      </div>
    </div>
  )
}

const chipStyle: React.CSSProperties = {
  padding: '2px 8px',
  background: '#1f1f3a',
  color: '#9fd9ff',
  border: '1px solid #2a3a5a',
  borderRadius: 10,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'monospace',
}
