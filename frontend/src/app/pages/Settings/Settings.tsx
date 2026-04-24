import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { AppDispatch, RootState } from '@/shared/state/store'
import {
  fetchServers,
  createServer,
  updateServer,
  deleteServer,
  discoverTools,
  fetchPermissions,
  setPermission,
  clearServerError,
} from '@/shared/state/mcpSlice'
import { fetchPolicies, createPolicy, deletePolicy } from '@/shared/state/commandPolicySlice'
import {
  getCanvasPrefs, setCanvasPrefs, DEFAULT_CANVAS_PREFS,
  getShortcuts, setShortcuts, DEFAULT_SHORTCUTS,
  type CanvasPrefs, type ShortcutBindings,
} from '@/shared/prefs'

type TabKey = 'providers' | 'mcp' | 'policies' | 'canvas' | 'shortcuts'

interface SettingsProps {
  onClose: () => void
}

export function Settings({ onClose }: SettingsProps) {
  const dispatch = useDispatch<AppDispatch>()
  const servers = useSelector((s: RootState) => s.mcp.servers)
  const tools = useSelector((s: RootState) => s.mcp.tools)
  const permissions = useSelector((s: RootState) => s.mcp.permissions)
  const discoveringId = useSelector((s: RootState) => s.mcp.discoveringId)
  const errorsById = useSelector((s: RootState) => s.mcp.errorsById)
  const policies = useSelector((s: RootState) => s.commandPolicies.policies)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showPolicyForm, setShowPolicyForm] = useState(false)
  const [policyPattern, setPolicyPattern] = useState('')
  const [policyPatternType, setPolicyPatternType] = useState<'glob' | 'regex'>('glob')
  const [policyAction, setPolicyAction] = useState<'allow' | 'deny' | 'ask'>('deny')
  const [policyScope, setPolicyScope] = useState<'global' | 'mode'>('global')
  const [tab, setTab] = useState<TabKey>('providers')

  // Server-side settings (API keys, provider config)
  const [providerConfig, setProviderConfig] = useState<{ ollama_base_url: string }>({ ollama_base_url: 'http://localhost:11434' })
  const [apiKeysMasked, setApiKeysMasked] = useState<Record<string, string>>({})
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({ anthropic: '', openai: '' })
  const [saveStatus, setSaveStatus] = useState<string>('')

  // Local-only prefs
  const [canvasPrefs, setCanvasPrefsState] = useState<CanvasPrefs>(getCanvasPrefs())
  const [shortcuts, setShortcutsState] = useState<ShortcutBindings>(getShortcuts())
  const [recordingBinding, setRecordingBinding] = useState<keyof ShortcutBindings | null>(null)

  // Add/edit form state
  const [editingServerId, setEditingServerId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formTransport, setFormTransport] = useState<'stdio' | 'http'>('stdio')
  const [formCommand, setFormCommand] = useState('')
  const [formArgs, setFormArgs] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formEnv, setFormEnv] = useState('')
  const [formHeaders, setFormHeaders] = useState('')
  const [formCallbackPort, setFormCallbackPort] = useState('')
  const [formOAuthClientId, setFormOAuthClientId] = useState('')
  const [formOAuthScopes, setFormOAuthScopes] = useState('')

  useEffect(() => {
    dispatch(fetchServers())
    dispatch(fetchPermissions())
    dispatch(fetchPolicies())
    fetch('/api/settings').then(r => r.json()).then((data) => {
      setProviderConfig({ ollama_base_url: data.provider_config?.ollama_base_url || 'http://localhost:11434' })
      setApiKeysMasked(data.api_keys_set || {})
    }).catch(() => {})
  }, [dispatch])

  const handleSaveServerSettings = async () => {
    setSaveStatus('Saving…')
    const body: any = { provider_config: providerConfig, api_keys: {} }
    for (const k of Object.keys(apiKeyInputs)) {
      const v = apiKeyInputs[k].trim()
      if (v) body.api_keys[k] = v
    }
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const data = await res.json()
      setApiKeysMasked(data.api_keys_set || {})
      setApiKeyInputs({ anthropic: '', openai: '' })
      setSaveStatus('Saved')
      setTimeout(() => setSaveStatus(''), 1500)
    } else {
      setSaveStatus('Save failed')
    }
  }

  const handleClearApiKey = async (name: string) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_keys: { [name]: '' } }),
    })
    if (res.ok) {
      const data = await res.json()
      setApiKeysMasked(data.api_keys_set || {})
    }
  }

  const handleCanvasPrefChange = (patch: Partial<CanvasPrefs>) => {
    const next = { ...canvasPrefs, ...patch }
    setCanvasPrefsState(next)
    setCanvasPrefs(next)
  }

  const handleRecordBinding = (key: keyof ShortcutBindings, e: React.KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') { setRecordingBinding(null); return }
    // Ignore pure-modifier presses
    if (['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) return
    const parts: string[] = []
    if (e.shiftKey) parts.push('Shift')
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.metaKey) parts.push('Meta')
    if (e.altKey) parts.push('Alt')
    parts.push(e.key.length === 1 && e.shiftKey ? e.key.toUpperCase() : e.key)
    const binding = parts.join('+')
    const next = { ...shortcuts, [key]: binding }
    setShortcutsState(next)
    setShortcuts(next)
    setRecordingBinding(null)
  }

  const resetForm = () => {
    setEditingServerId(null)
    setFormName('')
    setFormTransport('stdio')
    setFormCommand('')
    setFormArgs('')
    setFormUrl('')
    setFormEnv('')
    setFormHeaders('')
    setFormCallbackPort('')
    setFormOAuthClientId('')
    setFormOAuthScopes('')
    setShowAddForm(false)
  }

  const handleEditServer = (server: typeof servers[number]) => {
    setEditingServerId(server.id)
    setFormName(server.name)
    setFormTransport(server.transport)
    setFormCommand(server.command || '')
    setFormArgs((server.args || []).join(', '))
    setFormUrl(server.url || '')
    setFormEnv(
      Object.entries(server.env || {})
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    )
    setFormHeaders(
      Object.entries(server.headers || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    )
    setFormCallbackPort(server.callback_port ? String(server.callback_port) : '')
    setFormOAuthClientId(server.oauth_client_id || '')
    setFormOAuthScopes((server.oauth_scopes || []).join(' '))
    setShowAddForm(true)
  }

  const handleSubmitServer = async () => {
    if (!formName.trim()) return

    const envObj: Record<string, string> = {}
    formEnv.split('\n').forEach(line => {
      const idx = line.indexOf('=')
      if (idx > 0) {
        envObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
    })

    const headersObj: Record<string, string> = {}
    formHeaders.split('\n').forEach(line => {
      const idx = line.indexOf(':')
      if (idx > 0) {
        headersObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
    })

    const portNum = formCallbackPort.trim() ? parseInt(formCallbackPort.trim(), 10) : null
    const callbackPort = portNum && !Number.isNaN(portNum) ? portNum : null
    const scopes = formOAuthScopes.trim()
      ? formOAuthScopes.trim().split(/\s+/).filter(Boolean)
      : []

    const payload = {
      name: formName,
      transport: formTransport,
      command: formTransport === 'stdio' ? formCommand : undefined,
      args: formTransport === 'stdio' ? formArgs.split(',').map(a => a.trim()).filter(Boolean) : [],
      url: formTransport === 'http' ? formUrl : undefined,
      headers: formTransport === 'http' ? headersObj : {},
      callback_port: formTransport === 'http' ? callbackPort : null,
      oauth_client_id: formTransport === 'http' ? (formOAuthClientId.trim() || null) : null,
      oauth_scopes: formTransport === 'http' ? scopes : [],
      env: envObj,
      enabled: true,
    }

    if (editingServerId) {
      await dispatch(updateServer({ id: editingServerId, updates: payload }))
    } else {
      await dispatch(createServer(payload))
    }
    resetForm()
  }

  const handleToggleServer = (server: { id: string; enabled: boolean }) => {
    dispatch(updateServer({ id: server.id, updates: { enabled: !server.enabled } }))
  }

  const handleDeleteServer = (server: { id: string; name: string }) => {
    if (!window.confirm(`Delete MCP server "${server.name}"? This cannot be undone.`)) return
    dispatch(deleteServer(server.id))
  }

  const handleTestConnection = (serverId: string) => {
    dispatch(clearServerError(serverId))
    dispatch(discoverTools(serverId))
  }

  const handlePermissionChange = (toolName: string, policy: string) => {
    dispatch(setPermission({ toolName, policy }))
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
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#888',
    display: 'block',
    marginBottom: 4,
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0a0a0f',
          borderRadius: 12,
          border: '1px solid #333',
          width: 640,
          maxHeight: '80vh',
          overflow: 'auto',
          padding: 24,
          position: 'relative',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'transparent',
            border: 'none',
            color: '#888',
            fontSize: 20,
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <h2 style={{ margin: '0 0 16px', fontSize: 18, color: '#e0e0e0', fontWeight: 700 }}>
          Settings
        </h2>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #2a2a3e', marginBottom: 20 }}>
          {([
            ['providers', 'Providers & API keys'],
            ['mcp', 'MCP Servers'],
            ['policies', 'Command Policies'],
            ['canvas', 'Canvas'],
            ['shortcuts', 'Shortcuts'],
          ] as Array<[TabKey, string]>).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                color: tab === key ? '#4fc3f7' : '#888',
                border: 'none',
                borderBottom: tab === key ? '2px solid #4fc3f7' : '2px solid transparent',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'providers' && (
          <div>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#ccc', fontWeight: 600 }}>
              API Keys
            </h3>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 16px' }}>
              API keys are stored in your local AgentCanvas data directory as plaintext JSON. Do not use on a shared machine.
              Keys are applied as environment variables on save.
            </p>

            {(['anthropic', 'openai'] as const).map((name) => (
              <div key={name} style={{
                background: '#1a1a2e', borderRadius: 8, padding: 14, marginBottom: 12,
                border: '1px solid #333',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: '#e0e0e0', flex: 1, textTransform: 'capitalize' }}>
                    {name}
                  </span>
                  {apiKeysMasked[name] && (
                    <>
                      <span style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                        current: {apiKeysMasked[name]}
                      </span>
                      <button
                        onClick={() => handleClearApiKey(name)}
                        style={{
                          padding: '4px 10px', background: 'transparent', color: '#e57373',
                          border: '1px solid #5a2e2e', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                        }}
                      >Clear</button>
                    </>
                  )}
                </div>
                <input
                  type="password"
                  value={apiKeyInputs[name] || ''}
                  onChange={e => setApiKeyInputs(v => ({ ...v, [name]: e.target.value }))}
                  placeholder={apiKeysMasked[name] ? 'Enter new value to replace…' : 'Paste API key…'}
                  style={inputStyle}
                />
              </div>
            ))}

            <h3 style={{ margin: '24px 0 12px', fontSize: 15, color: '#ccc', fontWeight: 600 }}>
              Provider Configuration
            </h3>
            <label style={labelStyle}>Ollama base URL</label>
            <input
              value={providerConfig.ollama_base_url}
              onChange={e => setProviderConfig({ ...providerConfig, ollama_base_url: e.target.value })}
              placeholder="http://localhost:11434"
              style={inputStyle}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              {saveStatus && <span style={{ fontSize: 12, color: '#888', marginRight: 'auto' }}>{saveStatus}</span>}
              <button
                onClick={handleSaveServerSettings}
                style={{
                  padding: '8px 16px', background: '#4fc3f7', color: '#000',
                  border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13,
                }}
              >
                Save
              </button>
            </div>
          </div>
        )}

        {tab === 'canvas' && (
          <div>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#ccc', fontWeight: 600 }}>
              Canvas Preferences
            </h3>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 16px' }}>
              Stored locally in your browser.
            </p>

            <label style={labelStyle}>Zoom sensitivity: {canvasPrefs.zoomSensitivity.toFixed(2)}×</label>
            <input
              type="range" min={0.25} max={3} step={0.05}
              value={canvasPrefs.zoomSensitivity}
              onChange={e => handleCanvasPrefChange({ zoomSensitivity: parseFloat(e.target.value) })}
              style={{ width: '100%', marginBottom: 16 }}
            />

            <label style={labelStyle}>Grid size (px): {canvasPrefs.gridSize}</label>
            <input
              type="range" min={8} max={64} step={4}
              value={canvasPrefs.gridSize}
              onChange={e => handleCanvasPrefChange({ gridSize: parseInt(e.target.value) })}
              style={{ width: '100%', marginBottom: 16 }}
            />

            <button
              onClick={() => { setCanvasPrefsState(DEFAULT_CANVAS_PREFS); setCanvasPrefs(DEFAULT_CANVAS_PREFS) }}
              style={{
                padding: '6px 12px', background: 'transparent', color: '#888',
                border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: 12,
              }}
            >
              Reset defaults
            </button>
          </div>
        )}

        {tab === 'shortcuts' && (
          <div>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#ccc', fontWeight: 600 }}>
              Keyboard Shortcuts
            </h3>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 16px' }}>
              Click a binding to record a new one. Press Escape to cancel.
            </p>

            {(Object.keys(DEFAULT_SHORTCUTS) as Array<keyof ShortcutBindings>).map((key) => {
              const label: Record<keyof ShortcutBindings, string> = {
                newAgent: 'New agent dialog',
                settings: 'Open settings',
                history: 'Open history',
                templates: 'Open templates',
                approveAll: 'Approve all pending tools',
                denyAll: 'Deny all pending tools',
              }
              const isRecording = recordingBinding === key
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', background: '#1a1a2e', borderRadius: 6, marginBottom: 6,
                  border: '1px solid #333',
                }}>
                  <span style={{ flex: 1, fontSize: 13, color: '#ccc' }}>{label[key]}</span>
                  <button
                    onClick={() => setRecordingBinding(isRecording ? null : key)}
                    onKeyDown={isRecording ? (e) => handleRecordBinding(key, e) : undefined}
                    style={{
                      padding: '4px 10px', minWidth: 96,
                      background: isRecording ? '#2a4a5e' : '#12121e',
                      color: isRecording ? '#4fc3f7' : '#e0e0e0',
                      border: `1px solid ${isRecording ? '#4fc3f7' : '#333'}`,
                      borderRadius: 4, fontSize: 12, fontFamily: 'monospace', cursor: 'pointer',
                    }}
                  >
                    {isRecording ? 'press keys…' : shortcuts[key]}
                  </button>
                </div>
              )
            })}

            <button
              onClick={() => { setShortcutsState(DEFAULT_SHORTCUTS); setShortcuts(DEFAULT_SHORTCUTS) }}
              style={{
                marginTop: 12,
                padding: '6px 12px', background: 'transparent', color: '#888',
                border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: 12,
              }}
            >
              Reset defaults
            </button>
          </div>
        )}

        {tab === 'mcp' && <>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#ccc', fontWeight: 600 }}>
          MCP Servers
        </h3>

        {/* Server list */}
        {servers.map(server => (
          <div
            key={server.id}
            style={{
              background: '#1a1a2e',
              borderRadius: 8,
              padding: 16,
              marginBottom: 12,
              border: '1px solid #333',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#e0e0e0', flex: 1 }}>
                {server.name}
              </span>
              <span style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                background: server.transport === 'stdio' ? '#1e2e1e' : '#1e1e3e',
                color: server.transport === 'stdio' ? '#8be88b' : '#8b8be8',
              }}>
                {server.transport}
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={server.enabled}
                  onChange={() => handleToggleServer(server)}
                  style={{ accentColor: '#4fc3f7' }}
                />
                Enabled
              </label>
              <button
                onClick={() => handleTestConnection(server.id)}
                disabled={discoveringId === server.id}
                style={{
                  padding: '4px 10px',
                  background: 'transparent',
                  color: discoveringId === server.id ? '#666' : '#4fc3f7',
                  border: `1px solid ${discoveringId === server.id ? '#333' : '#4fc3f7'}`,
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: discoveringId === server.id ? 'wait' : 'pointer',
                }}
                title={server.transport === 'http' ? 'Discover tools (may open a browser tab for OAuth)' : 'Discover tools'}
              >
                {discoveringId === server.id ? 'Testing…' : 'Test Connection'}
              </button>
              <button
                onClick={() => handleEditServer(server)}
                style={{
                  padding: '4px 10px',
                  background: 'transparent',
                  color: '#ba68c8',
                  border: '1px solid #ba68c8',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Edit
              </button>
              <button
                onClick={() => handleDeleteServer(server)}
                style={{
                  padding: '4px 10px',
                  background: 'transparent',
                  color: '#e57373',
                  border: '1px solid #e57373',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>

            {errorsById[server.id] && (
              <div style={{
                marginTop: 6, marginBottom: 6,
                padding: '6px 10px',
                background: '#2e1414',
                border: '1px solid #5a2e2e',
                borderRadius: 4,
                color: '#e57373',
                fontSize: 11,
                wordBreak: 'break-word',
              }}>
                {errorsById[server.id]}
              </div>
            )}

            {server.transport === 'stdio' && (
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                Command: {server.command} {server.args?.join(' ')}
              </div>
            )}
            {server.transport === 'http' && (
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                URL: {server.url}
              </div>
            )}

            {/* Discovered tools */}
            {tools[server.id] && tools[server.id].length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8, fontWeight: 600 }}>
                  Discovered Tools ({tools[server.id].length})
                </div>
                {tools[server.id].map(tool => (
                  <div
                    key={tool.qualified_name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 0',
                      borderTop: '1px solid #2a2a3e',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: '#e0e0e0', fontWeight: 500 }}>
                        {tool.name}
                      </div>
                      <div style={{ fontSize: 10, color: '#666' }}>
                        {tool.description}
                      </div>
                    </div>
                    <select
                      value={permissions[tool.qualified_name] || 'ask'}
                      onChange={e => handlePermissionChange(tool.qualified_name, e.target.value)}
                      style={{
                        padding: '4px 8px',
                        background: '#12121e',
                        color: '#e0e0e0',
                        border: '1px solid #333',
                        borderRadius: 4,
                        fontSize: 11,
                      }}
                    >
                      <option value="always_allow">Always Allow</option>
                      <option value="ask">Ask</option>
                      <option value="deny">Deny</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Add Server Form */}
        {showAddForm ? (
          <div style={{
            background: '#1a1a2e',
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
            border: '1px solid #4fc3f7',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#e0e0e0' }}>
              {editingServerId ? 'Edit Server' : 'Add Server'}
            </h3>

            <label style={labelStyle}>Name</label>
            <input
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="My MCP Server"
              style={inputStyle}
            />

            <label style={labelStyle}>Transport</label>
            <select
              value={formTransport}
              onChange={e => setFormTransport(e.target.value as 'stdio' | 'http')}
              style={inputStyle}
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>

            {formTransport === 'stdio' ? (
              <>
                <label style={labelStyle}>Command</label>
                <input
                  value={formCommand}
                  onChange={e => setFormCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  style={inputStyle}
                />

                <label style={labelStyle}>Arguments (comma-separated)</label>
                <input
                  value={formArgs}
                  onChange={e => setFormArgs(e.target.value)}
                  placeholder="/path/to/dir, --flag"
                  style={inputStyle}
                />
              </>
            ) : (
              <>
                <label style={labelStyle}>URL</label>
                <input
                  value={formUrl}
                  onChange={e => setFormUrl(e.target.value)}
                  placeholder="https://gitlab.example.com:8765/mcp"
                  style={inputStyle}
                />

                <label style={labelStyle}>OAuth callback port</label>
                <input
                  value={formCallbackPort}
                  onChange={e => setFormCallbackPort(e.target.value)}
                  placeholder="8765  (blank = default)"
                  inputMode="numeric"
                  style={inputStyle}
                />

                <label style={labelStyle}>OAuth client_id (optional — for pre-registered clients, skips dynamic registration)</label>
                <input
                  value={formOAuthClientId}
                  onChange={e => setFormOAuthClientId(e.target.value)}
                  placeholder="mi-c3.affectli.com"
                  style={inputStyle}
                />

                <label style={labelStyle}>OAuth scopes (space-separated — optional; include 'offline_access' for refresh tokens)</label>
                <input
                  value={formOAuthScopes}
                  onChange={e => setFormOAuthScopes(e.target.value)}
                  placeholder="openid profile offline_access"
                  style={inputStyle}
                />

                <label style={labelStyle}>Static headers (Header: value, one per line — optional)</label>
                <textarea
                  value={formHeaders}
                  onChange={e => setFormHeaders(e.target.value)}
                  placeholder={"Authorization: Bearer xxx\nX-Org: acme"}
                  style={{ ...inputStyle, minHeight: 48, resize: 'vertical' }}
                />
              </>
            )}

            <label style={labelStyle}>Environment Variables (KEY=VALUE, one per line)</label>
            <textarea
              value={formEnv}
              onChange={e => setFormEnv(e.target.value)}
              placeholder={"API_KEY=xxx\nDEBUG=true"}
              style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={resetForm}
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
                onClick={handleSubmitServer}
                disabled={!formName.trim()}
                style={{
                  padding: '8px 16px',
                  background: '#4fc3f7',
                  color: '#000',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 13,
                  opacity: !formName.trim() ? 0.4 : 1,
                }}
              >
                {editingServerId ? 'Save Changes' : 'Add Server'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              width: '100%',
              padding: '10px 16px',
              background: 'transparent',
              color: '#4fc3f7',
              border: '1px dashed #4fc3f7',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            + Add Server
          </button>
        )}

        </>}

        {tab === 'policies' && <>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#ccc', fontWeight: 600 }}>
          Command Policies
          <span style={{ fontSize: 11, color: '#666', fontWeight: 400, marginLeft: 8 }}>
            Control which shell commands agents can run
          </span>
        </h3>

        {policies.map(policy => (
          <div key={policy.id} style={{
            background: '#1a1a2e', borderRadius: 8, padding: '10px 14px', marginBottom: 8,
            border: '1px solid #333', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{
              fontSize: 12, fontFamily: 'monospace', color: '#e0e0e0', flex: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {policy.pattern}
            </span>
            <span style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 3,
              background: policy.pattern_type === 'regex' ? '#2e1e3e' : '#1e2e1e',
              color: policy.pattern_type === 'regex' ? '#b39ddb' : '#8be88b',
            }}>
              {policy.pattern_type}
            </span>
            <span style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 600,
              background: policy.action === 'deny' ? '#3e1e1e' : policy.action === 'allow' ? '#1e3e1e' : '#3e3e1e',
              color: policy.action === 'deny' ? '#ef5350' : policy.action === 'allow' ? '#66bb6a' : '#ffa726',
            }}>
              {policy.action}
            </span>
            <span style={{ fontSize: 10, color: '#666' }}>
              {policy.scope}{policy.scope_id ? `: ${policy.scope_id}` : ''}
            </span>
            <button
              onClick={() => dispatch(deletePolicy(policy.id))}
              style={{
                background: 'none', border: 'none', color: '#ef5350', cursor: 'pointer', fontSize: 14,
              }}
            >
              ×
            </button>
          </div>
        ))}

        {showPolicyForm ? (
          <div style={{
            background: '#1a1a2e', borderRadius: 8, padding: 16, marginBottom: 12,
            border: '1px solid #4fc3f7',
          }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 13, color: '#e0e0e0' }}>Add Command Policy</h4>

            <label style={labelStyle}>Pattern</label>
            <input
              value={policyPattern}
              onChange={e => setPolicyPattern(e.target.value)}
              placeholder="rm*, git push*, curl*"
              style={inputStyle}
            />

            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Pattern type</label>
                <select value={policyPatternType} onChange={e => setPolicyPatternType(e.target.value as any)} style={inputStyle}>
                  <option value="glob">Glob</option>
                  <option value="regex">Regex</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Action</label>
                <select value={policyAction} onChange={e => setPolicyAction(e.target.value as any)} style={inputStyle}>
                  <option value="deny">Deny</option>
                  <option value="ask">Ask</option>
                  <option value="allow">Allow</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Scope</label>
                <select value={policyScope} onChange={e => setPolicyScope(e.target.value as any)} style={inputStyle}>
                  <option value="global">Global</option>
                  <option value="mode">Mode</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowPolicyForm(false); setPolicyPattern('') }}
                style={{
                  padding: '6px 14px', background: 'transparent', color: '#888',
                  border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                }}
              >Cancel</button>
              <button
                onClick={() => {
                  if (!policyPattern.trim()) return
                  dispatch(createPolicy({
                    pattern: policyPattern,
                    pattern_type: policyPatternType,
                    action: policyAction,
                    scope: policyScope,
                  }))
                  setShowPolicyForm(false)
                  setPolicyPattern('')
                }}
                style={{
                  padding: '6px 14px', background: '#4fc3f7', color: '#000',
                  border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12,
                }}
              >Add Policy</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowPolicyForm(true)}
            style={{
              width: '100%', padding: '8px 16px', background: 'transparent',
              color: '#4fc3f7', border: '1px dashed #4fc3f7', borderRadius: 8,
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            + Add Command Policy
          </button>
        )}
        </>}
      </div>
    </div>
  )
}
