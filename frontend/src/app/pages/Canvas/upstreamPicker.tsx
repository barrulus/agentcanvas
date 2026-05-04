import { useEffect, useMemo, useState } from 'react'

export type UpstreamNode = { id: string; name: string; isImmediate: boolean }

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
    // Try to find a JSON object embedded in the text (mirrors backend _extract_json).
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}

export function UpstreamPicker({
  upstream,
  onInsert,
}: {
  upstream: UpstreamNode[]
  onInsert: (snippet: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string>('')
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => upstream.find((u) => u.id === selectedId), [upstream, selectedId])

  useEffect(() => {
    if (!selectedId) { setLastRun(null); setError(null); return }
    let cancelled = false
    setError(null)
    fetch(`/api/sessions/${selectedId}/last-run`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => { if (!cancelled) setLastRun(data) })
      .catch((e) => { if (!cancelled) { setLastRun(null); setError(String(e?.message ?? e)) } })
    return () => { cancelled = true }
  }, [selectedId])

  const paths = useMemo(() => {
    const parsed = parseJsonLoose(lastRun?.response_out ?? null)
    return discoverPaths(parsed)
  }, [lastRun])

  const buildSnippet = (path: string | null) => {
    if (!selected) return ''
    if (selected.isImmediate) return path ? `{{output.${path}}}` : `{{output}}`
    return path ? `{{nodes.${selected.name}.output.${path}}}` : `{{nodes.${selected.name}.output}}`
  }

  if (upstream.length === 0) return null

  return (
    <div style={{ marginBottom: 8, padding: 8, background: '#13132a', borderRadius: 6, border: '1px solid #2a2a44' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#888' }}>Insert from upstream:</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{ flex: 1, background: '#0d0d1f', color: '#e0e0e0', border: '1px solid #333', borderRadius: 4, padding: '4px 6px', fontSize: 12 }}
        >
          <option value="">— pick a node —</option>
          {upstream.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}{u.isImmediate ? ' (immediate)' : ''}
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button
            type="button"
            onClick={() => onInsert(buildSnippet(null))}
            style={chipStyle}
            title="Insert full text"
          >
            output
          </button>
          {paths.map((p) => (
            <button key={p} type="button" onClick={() => onInsert(buildSnippet(p))} style={chipStyle} title={`Insert ${p}`}>
              {p}
            </button>
          ))}
          {paths.length === 0 && lastRun && (
            <span style={{ fontSize: 11, color: '#666' }}>No JSON fields detected in last output.</span>
          )}
          {error && <span style={{ fontSize: 11, color: '#888' }}>Couldn't load output preview.</span>}
        </div>
      )}
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
