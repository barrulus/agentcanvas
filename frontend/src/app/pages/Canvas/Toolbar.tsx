import { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { AppDispatch, RootState } from '@/shared/state/store'
import { createSession, fetchProviders, fetchSessions } from '@/shared/state/agentsSlice'
import { placeCard, loadLayout, addConnection, fetchDashboards, createDashboard, switchDashboard, createGroup } from '@/shared/state/canvasSlice'
import { createViewCard, fetchViewCards } from '@/shared/state/viewCardsSlice'
import { createInputCard, fetchInputCards } from '@/shared/state/inputCardsSlice'
import { fetchModes } from '@/shared/state/modesSlice'
import { fetchTemplates, PromptTemplate } from '@/shared/state/templatesSlice'
import { wsManager } from '@/shared/ws/WebSocketManager'

function renderTemplate(prompt: string, fieldValues: Record<string, string>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => fieldValues[key] || `{{${key}}}`)
}

interface ToolbarProps {
  onOpenSettings?: () => void
  onOpenHistory?: () => void
  onOpenTemplates?: () => void
  showDialog?: boolean
  setShowDialog?: (v: boolean) => void
  initialTemplate?: PromptTemplate | null
  onTemplateClear?: () => void
}

export function Toolbar({ onOpenSettings, onOpenHistory, onOpenTemplates, showDialog: showDialogProp, setShowDialog: setShowDialogProp, initialTemplate, onTemplateClear }: ToolbarProps) {
  const dispatch = useDispatch<AppDispatch>()
  const providers = useSelector((s: RootState) => s.agents.providers)
  const sessions = useSelector((s: RootState) => s.agents.sessions)
  const dashboards = useSelector((s: RootState) => s.canvas.dashboards)
  const currentDashboardId = useSelector((s: RootState) => s.canvas.currentDashboardId)
  const modes = useSelector((s: RootState) => s.modes.modes)
  const selectedCards = useSelector((s: RootState) => s.canvas.selectedCards)
  const [showDialogInternal, setShowDialogInternal] = useState(false)
  const showDialog = showDialogProp ?? showDialogInternal
  const setShowDialog = setShowDialogProp ?? setShowDialogInternal
  const [selectedProvider, setSelectedProvider] = useState('')
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedMode, setSelectedMode] = useState('agent')
  const [agentName, setAgentName] = useState('')
  const [cwd, setCwd] = useState('')
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null)
  const [templateFields, setTemplateFields] = useState<Record<string, string>>({})
  const templates = useSelector((s: RootState) => s.templates.templates)
  const [showInputMenu, setShowInputMenu] = useState(false)

  useEffect(() => {
    dispatch(fetchProviders())
    dispatch(fetchModes())
    dispatch(fetchTemplates())
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
        dispatch(fetchViewCards(currentDashboardId))
        dispatch(fetchInputCards(currentDashboardId))
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

  // Apply template from prop (e.g., from Templates panel "Use" button)
  useEffect(() => {
    if (initialTemplate) {
      applyTemplate(initialTemplate)
    }
  }, [initialTemplate])

  const applyTemplate = (template: PromptTemplate) => {
    setSelectedTemplate(template)
    // Initialize field values with defaults
    const defaults: Record<string, string> = {}
    for (const f of template.fields) {
      defaults[f.name] = f.default || ''
    }
    setTemplateFields(defaults)
    // Pre-fill system prompt
    if (template.system_prompt) {
      setSystemPrompt(template.system_prompt)
      setShowAdvanced(true)
    }
    // Pre-fill provider and model
    if (template.provider_id) {
      handleProviderChange(template.provider_id).then(() => {
        if (template.model) setSelectedModel(template.model)
      })
    }
  }

  const clearTemplate = () => {
    setSelectedTemplate(null)
    setTemplateFields({})
    onTemplateClear?.()
  }

  const handleProviderChange = async (providerId: string) => {
    setSelectedProvider(providerId)
    const res = await fetch(`/api/providers/${providerId}/models`)
    const data = await res.json()
    setModels(data.models)
    if (data.models.length > 0) setSelectedModel(data.models[0].id)
  }

  const handleCreate = async () => {
    // Determine the effective message: use template rendering if template is active
    const effectivePrompt = selectedTemplate
      ? renderTemplate(selectedTemplate.prompt, templateFields)
      : prompt.trim()
    if (!selectedProvider || !selectedModel) return
    const result = await dispatch(createSession({
      provider_id: selectedProvider,
      model: selectedModel,
      name: agentName.trim() || undefined,
      system_prompt: systemPrompt.trim() || undefined,
      dashboard_id: currentDashboardId,
      mode_id: selectedMode || undefined,
      cwd: cwd.trim() || undefined,
    })).unwrap()

    dispatch(placeCard({ sessionId: result.id }))
    if (effectivePrompt) {
      wsManager.sendMessage(result.id, effectivePrompt)
    }

    setShowDialog(false)
    setAgentName('')
    setPrompt('')
    setSystemPrompt('')
    setShowAdvanced(false)
    setCwd('')
    clearTemplate()
  }

  const handleSwitchDashboard = (dashboardId: string) => {
    if (dashboardId === currentDashboardId) return
    dispatch(switchDashboard(dashboardId))
    dispatch(loadLayout(dashboardId))
    dispatch(fetchSessions(dashboardId))
    dispatch(fetchViewCards(dashboardId))
    dispatch(fetchInputCards(dashboardId))
  }

  const handleCreateViewCard = async () => {
    const result = await dispatch(createViewCard({
      name: 'Output',
      dashboard_id: currentDashboardId,
    })).unwrap()
    dispatch(placeCard({ sessionId: result.id, card_type: 'view' }))
  }

  const handleCreateInputCard = async (sourceType: 'chat' | 'webhook' | 'file') => {
    setShowInputMenu(false)
    const config: Record<string, any> = {}
    let name = 'Input'
    if (sourceType === 'file') {
      const path = window.prompt('File or directory path to watch:')
      if (!path?.trim()) return
      config.path = path.trim()
      name = path.trim().split('/').pop() || 'File Input'
    } else if (sourceType === 'webhook') {
      name = 'Webhook'
    }
    const result = await dispatch(createInputCard({
      name,
      source_type: sourceType,
      config,
      dashboard_id: currentDashboardId,
    })).unwrap()
    dispatch(placeCard({ sessionId: result.id, card_type: 'input' }))
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
        onClick={onOpenTemplates}
        style={{
          padding: '6px 12px',
          background: 'transparent',
          color: '#888',
          border: '1px solid #333',
          borderRadius: 6,
          fontSize: 13,
          cursor: 'pointer',
          lineHeight: 1,
        }}
        title="Templates"
      >
        T
      </button>

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

      {selectedCards.length > 1 && (
        <button
          onClick={() => {
            const name = window.prompt('Group name:', 'Group')
            if (name?.trim()) dispatch(createGroup({ memberIds: selectedCards, name: name.trim() }))
          }}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            color: '#66bb6a',
            border: '1px solid #2e5a2e',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
          title="Group selected cards"
        >
          Group ({selectedCards.length})
        </button>
      )}

      {/* Input Card dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowInputMenu(!showInputMenu)}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            color: '#4fc3f7',
            border: '1px solid #1a4a5e',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
          title="Add an input card (workflow entry point)"
        >
          + Input Card
        </button>
        {showInputMenu && (
          <div
            style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              background: '#1a1a2e', border: '1px solid #333', borderRadius: 8,
              padding: 4, zIndex: 10000, minWidth: 160,
            }}
          >
            <button onClick={() => handleCreateInputCard('chat')} style={inputMenuItemStyle}>
              Chat Input
              <span style={{ color: '#555', fontSize: 10, display: 'block' }}>Manual text entry</span>
            </button>
            <button onClick={() => handleCreateInputCard('webhook')} style={inputMenuItemStyle}>
              Webhook
              <span style={{ color: '#555', fontSize: 10, display: 'block' }}>HTTP POST endpoint</span>
            </button>
            <button onClick={() => handleCreateInputCard('file')} style={inputMenuItemStyle}>
              File Watcher
              <span style={{ color: '#555', fontSize: 10, display: 'block' }}>Watch file for changes</span>
            </button>
          </div>
        )}
      </div>

      <button
        onClick={handleCreateViewCard}
        style={{
          padding: '6px 12px',
          background: 'transparent',
          color: '#b39ddb',
          border: '1px solid #4a3a66',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer',
        }}
        title="Add a view/output card"
      >
        + View Card
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

            {/* Template selector */}
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Template (optional)</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <select
                value={selectedTemplate?.id || ''}
                onChange={e => {
                  const t = templates.find(t => t.id === e.target.value)
                  if (t) applyTemplate(t)
                  else clearTemplate()
                }}
                style={{
                  flex: 1, padding: '8px 12px',
                  background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                  borderRadius: 6, fontSize: 13,
                }}
              >
                <option value="">No template</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.is_builtin ? ' (built-in)' : ''}</option>
                ))}
              </select>
              {selectedTemplate && (
                <button onClick={clearTemplate} style={{
                  background: 'none', border: '1px solid #333', color: '#888', borderRadius: 6,
                  padding: '4px 8px', cursor: 'pointer', fontSize: 12,
                }}>Clear</button>
              )}
            </div>

            {/* Template fields */}
            {selectedTemplate && selectedTemplate.fields.length > 0 && (
              <div style={{ marginBottom: 12, padding: 12, background: '#12121e', borderRadius: 8, border: '1px solid #2a2a3e' }}>
                <span style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 8 }}>Template fields</span>
                {selectedTemplate.fields.map(field => (
                  <div key={field.name} style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>
                      {field.label}{field.required ? ' *' : ''}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        value={templateFields[field.name] || field.default || ''}
                        onChange={e => setTemplateFields(f => ({ ...f, [field.name]: e.target.value }))}
                        style={{
                          width: '100%', padding: '6px 10px',
                          background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333',
                          borderRadius: 4, fontSize: 12,
                        }}
                      >
                        {(field.options || []).map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        value={templateFields[field.name] || ''}
                        onChange={e => setTemplateFields(f => ({ ...f, [field.name]: e.target.value }))}
                        placeholder={field.placeholder || undefined}
                        style={{
                          width: '100%', padding: '6px 10px', minHeight: 60, resize: 'vertical',
                          background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333',
                          borderRadius: 4, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box',
                        }}
                      />
                    ) : (
                      <input
                        value={templateFields[field.name] || ''}
                        onChange={e => setTemplateFields(f => ({ ...f, [field.name]: e.target.value }))}
                        placeholder={field.placeholder || undefined}
                        type={field.type === 'number' ? 'number' : 'text'}
                        style={{
                          width: '100%', padding: '6px 10px',
                          background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333',
                          borderRadius: 4, fontSize: 12, boxSizing: 'border-box',
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Mode selector */}
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Mode</label>
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {modes.map(m => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMode(m.id)}
                  style={{
                    padding: '4px 12px',
                    background: selectedMode === m.id ? '#4fc3f7' : '#12121e',
                    color: selectedMode === m.id ? '#000' : '#888',
                    border: `1px solid ${selectedMode === m.id ? '#4fc3f7' : '#333'}`,
                    borderRadius: 4, fontSize: 12, cursor: 'pointer', fontWeight: selectedMode === m.id ? 600 : 400,
                  }}
                  title={m.description || undefined}
                >
                  {m.icon && <span style={{ marginRight: 4 }}>{m.icon}</span>}
                  {m.name}
                </button>
              ))}
            </div>

            {/* Agent name */}
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Name (optional)</label>
            <input
              value={agentName}
              onChange={e => setAgentName(e.target.value)}
              placeholder="e.g. Researcher, Code Reviewer..."
              style={{
                width: '100%', padding: '8px 12px', marginBottom: 12,
                background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
              }}
            />

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
                width: '100%', padding: '8px 12px', marginBottom: 12,
                background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                borderRadius: 6, fontSize: 13, minHeight: 80, resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />

            {/* Advanced toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                background: 'none', border: 'none', color: '#666', fontSize: 11,
                cursor: 'pointer', padding: 0, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span style={{ fontSize: 8 }}>{showAdvanced ? '▼' : '▶'}</span>
              Advanced options
            </button>

            {showAdvanced && <>
              {/* System prompt */}
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>
                System prompt (optional)
                <span style={{ color: '#555', fontWeight: 400 }}> — defines the agent's role and behavior</span>
              </label>
              <textarea
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                placeholder="e.g. You are a code reviewer. Analyze code for bugs, security issues, and style. Return findings as a bullet list."
                style={{
                  width: '100%', padding: '8px 12px', marginBottom: 12,
                  background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                  borderRadius: 6, fontSize: 13, minHeight: 60, maxHeight: 200, resize: 'vertical',
                  fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />

              {/* Working directory */}
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Working directory (optional)</label>
            <input
              value={cwd}
              onChange={e => setCwd(e.target.value)}
              placeholder="/path/to/project (enables git worktree isolation)"
              style={{
                width: '100%', padding: '8px 12px', marginBottom: 16,
                background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
                borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
              }}
            />
            </>}

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
                disabled={!selectedProvider || !selectedModel}
                style={{
                  padding: '8px 16px', background: '#4fc3f7', color: '#000',
                  border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13,
                  opacity: (!selectedProvider || !selectedModel) ? 0.4 : 1,
                }}
              >
                {(prompt.trim() || selectedTemplate) ? 'Create & Send' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inputMenuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '6px 12px',
  background: 'transparent', color: '#ccc', border: 'none',
  fontSize: 12, cursor: 'pointer', textAlign: 'left', borderRadius: 4,
}
