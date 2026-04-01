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
} from '@/shared/state/mcpSlice'

interface SettingsProps {
  onClose: () => void
}

export function Settings({ onClose }: SettingsProps) {
  const dispatch = useDispatch<AppDispatch>()
  const servers = useSelector((s: RootState) => s.mcp.servers)
  const tools = useSelector((s: RootState) => s.mcp.tools)
  const permissions = useSelector((s: RootState) => s.mcp.permissions)
  const [showAddForm, setShowAddForm] = useState(false)

  // Add form state
  const [formName, setFormName] = useState('')
  const [formTransport, setFormTransport] = useState<'stdio' | 'http'>('stdio')
  const [formCommand, setFormCommand] = useState('')
  const [formArgs, setFormArgs] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formEnv, setFormEnv] = useState('')

  useEffect(() => {
    dispatch(fetchServers())
    dispatch(fetchPermissions())
  }, [dispatch])

  const resetForm = () => {
    setFormName('')
    setFormTransport('stdio')
    setFormCommand('')
    setFormArgs('')
    setFormUrl('')
    setFormEnv('')
    setShowAddForm(false)
  }

  const handleAddServer = async () => {
    if (!formName.trim()) return

    const envObj: Record<string, string> = {}
    formEnv.split('\n').forEach(line => {
      const idx = line.indexOf('=')
      if (idx > 0) {
        envObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
    })

    await dispatch(createServer({
      name: formName,
      transport: formTransport,
      command: formTransport === 'stdio' ? formCommand : undefined,
      args: formTransport === 'stdio' ? formArgs.split(',').map(a => a.trim()).filter(Boolean) : undefined,
      url: formTransport === 'http' ? formUrl : undefined,
      env: Object.keys(envObj).length > 0 ? envObj : undefined,
      enabled: true,
    }))
    resetForm()
  }

  const handleToggleServer = (server: { id: string; enabled: boolean }) => {
    dispatch(updateServer({ id: server.id, updates: { enabled: !server.enabled } }))
  }

  const handleDeleteServer = (id: string) => {
    dispatch(deleteServer(id))
  }

  const handleTestConnection = (serverId: string) => {
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

        <h2 style={{ margin: '0 0 20px', fontSize: 18, color: '#e0e0e0', fontWeight: 700 }}>
          MCP Server Settings
        </h2>

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
                style={{
                  padding: '4px 10px',
                  background: 'transparent',
                  color: '#4fc3f7',
                  border: '1px solid #4fc3f7',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Test Connection
              </button>
              <button
                onClick={() => handleDeleteServer(server.id)}
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
            <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#e0e0e0' }}>Add Server</h3>

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
                  placeholder="http://localhost:8080/mcp"
                  style={inputStyle}
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
                onClick={handleAddServer}
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
                Add Server
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
      </div>
    </div>
  )
}
