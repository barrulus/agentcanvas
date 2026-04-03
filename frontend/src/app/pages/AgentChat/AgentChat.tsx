import { useRef, useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { clearApprovalRequest, branchMessage } from '@/shared/state/agentsSlice'
import { wsManager } from '@/shared/ws/WebSocketManager'
import { ApprovalBar } from './ApprovalBar'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function getActiveBranchMessages(session: any): any[] {
  if (!session.branches || Object.keys(session.branches).length === 0) {
    return session.messages
  }
  const activeBranch = session.active_branch_id
  if (!activeBranch) return session.messages

  // Collect the chain of branch IDs from root to active
  const branchChain = new Set<string>()
  let current = activeBranch
  while (current) {
    branchChain.add(current)
    const b = session.branches[current]
    current = b?.parent_branch_id || null
  }

  return session.messages.filter((m: any) =>
    m.branch_id == null || branchChain.has(m.branch_id)
  )
}

function getSiblingBranches(session: any, messageId: string): string[] {
  // Find branches that fork after the parent of this message
  if (!session.branches) return []
  const msg = session.messages.find((m: any) => m.id === messageId)
  if (!msg || !msg.parent_id) return []

  // Find all messages that share the same parent_id (siblings)
  const siblings = session.messages.filter(
    (m: any) => m.parent_id === msg.parent_id && m.role === 'user'
  )
  if (siblings.length <= 1) return []

  // Return the branch_ids of siblings
  return siblings.map((m: any) => m.branch_id).filter(Boolean)
}

export function AgentChat({ sessionId }: { sessionId: string }) {
  const dispatch = useDispatch<AppDispatch>()
  const session = useSelector((s: RootState) => s.agents.sessions[sessionId])
  const templates = useSelector((s: RootState) => s.templates.templates)
  const [input, setInput] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [slashSuggestions, setSlashSuggestions] = useState<Array<{ slug: string; name: string }>>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [session?.messages, session?.streamingMessage])

  // Slash command autocomplete
  useEffect(() => {
    if (input.startsWith('/') && input.length > 1) {
      const query = input.slice(1).toLowerCase()
      const matches = templates
        .filter(t => t.slug.toLowerCase().startsWith(query) || t.name.toLowerCase().includes(query))
        .slice(0, 5)
        .map(t => ({ slug: t.slug, name: t.name }))
      setSlashSuggestions(matches)
    } else if (input === '/') {
      setSlashSuggestions(templates.slice(0, 5).map(t => ({ slug: t.slug, name: t.name })))
    } else {
      setSlashSuggestions([])
    }
  }, [input, templates])

  if (!session) return null

  const displayMessages = getActiveBranchMessages(session)

  const handleSend = () => {
    if (!input.trim()) return

    // Check for slash command
    if (input.startsWith('/')) {
      const slug = input.slice(1).split(/\s/)[0]
      const template = templates.find(t => t.slug === slug)
      if (template) {
        // If template has no fields, render and send directly
        if (template.fields.length === 0) {
          wsManager.sendMessage(sessionId, template.prompt)
          setInput('')
          setSlashSuggestions([])
          return
        }
        // With fields: substitute any provided text after the slug
        const rest = input.slice(1 + slug.length).trim()
        if (rest) {
          let rendered = template.prompt
          template.fields.forEach((f, i) => {
            const parts = rest.split(/\s+/)
            rendered = rendered.replace(`{{${f.name}}}`, parts[i] || f.default || '')
          })
          wsManager.sendMessage(sessionId, rendered)
          setInput('')
          setSlashSuggestions([])
          return
        }
      }
    }

    wsManager.sendMessage(sessionId, input)
    setInput('')
    setSlashSuggestions([])
  }

  const handleEditSubmit = (messageId: string) => {
    if (!editText.trim()) return
    // Find the message before this one (its parent for branching)
    const msgIdx = session.messages.findIndex((m: any) => m.id === messageId)
    const parentMsg = msgIdx > 0 ? session.messages[msgIdx - 1] : null
    const forkAfter = parentMsg?.id || messageId

    dispatch(branchMessage({ sessionId, forkAfterMessageId: forkAfter, content: editText }))
    setEditingMessageId(null)
    setEditText('')
  }

  const selectSlashSuggestion = (slug: string) => {
    setInput(`/${slug} `)
    setSlashSuggestions([])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {session.pendingApproval && (
        <ApprovalBar
          approvalId={session.pendingApproval.approvalId}
          toolName={session.pendingApproval.toolName}
          arguments={session.pendingApproval.arguments}
          onApprove={() => {
            wsManager.sendApprovalResponse(session.pendingApproval!.approvalId, true)
            dispatch(clearApprovalRequest(sessionId))
          }}
          onDeny={() => {
            wsManager.sendApprovalResponse(session.pendingApproval!.approvalId, false)
            dispatch(clearApprovalRequest(sessionId))
          }}
        />
      )}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {displayMessages.map((msg: any) => {
          const siblings = getSiblingBranches(session, msg.id)
          return (
            <div key={msg.id}>
              {siblings.length > 1 && msg.role === 'user' && (
                <BranchIndicator
                  branches={siblings}
                  activeBranch={session.active_branch_id}
                  sessionId={sessionId}
                />
              )}
              <MessageBubble
                message={msg}
                onEdit={msg.role === 'user' ? () => {
                  setEditingMessageId(msg.id)
                  setEditText(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
                } : undefined}
              />
              {editingMessageId === msg.id && (
                <div style={{
                  margin: '4px 0 8px', padding: 8, background: '#1e3a5f', borderRadius: 6, border: '1px solid #4fc3f722',
                }}>
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSubmit(msg.id) }}}
                    style={{
                      width: '100%', padding: '6px 8px', background: '#12121e', color: '#e0e0e0',
                      border: '1px solid #333', borderRadius: 4, fontSize: 12, fontFamily: 'inherit',
                      minHeight: 40, resize: 'vertical', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditingMessageId(null)} style={{
                      padding: '3px 8px', background: 'transparent', color: '#888', border: '1px solid #333',
                      borderRadius: 4, fontSize: 11, cursor: 'pointer',
                    }}>Cancel</button>
                    <button onClick={() => handleEditSubmit(msg.id)} style={{
                      padding: '3px 8px', background: '#4fc3f7', color: '#000', border: 'none',
                      borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>Fork & Send</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {session.streamingMessage && (
          <MessageBubble
            message={{
              id: session.streamingMessage.id,
              role: session.streamingMessage.role as any,
              content: session.streamingMessage.content,
              timestamp: Date.now() / 1000,
              tool_name: session.streamingMessage.tool_name,
            }}
            isStreaming
          />
        )}
      </div>

      <div style={{ position: 'relative', padding: 8, borderTop: '1px solid #222', display: 'flex', gap: 8 }}>
        {slashSuggestions.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 8, right: 8,
            background: '#1a1a2e', border: '1px solid #333', borderRadius: 6,
            overflow: 'hidden', zIndex: 10,
          }}>
            {slashSuggestions.map(s => (
              <div
                key={s.slug}
                onClick={() => selectSlashSuggestion(s.slug)}
                style={{
                  padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                  display: 'flex', gap: 8, alignItems: 'center',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#2a2a3e')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ color: '#4fc3f7' }}>/{s.slug}</span>
                <span style={{ color: '#666' }}>{s.name}</span>
              </div>
            ))}
          </div>
        )}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }}}
          placeholder="Send a message... (/ for templates)"
          style={{
            flex: 1, padding: '6px 10px',
            background: '#12121e', color: '#e0e0e0',
            border: '1px solid #333', borderRadius: 6,
            fontSize: 12, fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSend}
          style={{
            padding: '6px 12px', background: '#4fc3f7', color: '#000',
            border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}

function BranchIndicator({ branches, activeBranch, sessionId }: {
  branches: string[]
  activeBranch?: string | null
  sessionId: string
}) {
  const currentIdx = activeBranch ? branches.indexOf(activeBranch) : 0
  const handleSwitch = (branchId: string) => {
    fetch(`/api/sessions/${sessionId}/switch-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_id: branchId }),
    })
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '2px 0', fontSize: 10, color: '#888',
    }}>
      <button
        onClick={() => currentIdx > 0 && handleSwitch(branches[currentIdx - 1])}
        disabled={currentIdx <= 0}
        style={{
          background: 'none', border: 'none', color: currentIdx > 0 ? '#4fc3f7' : '#333',
          cursor: currentIdx > 0 ? 'pointer' : 'default', fontSize: 12, padding: 0,
        }}
      >&lt;</button>
      <span>Branch {currentIdx + 1}/{branches.length}</span>
      <button
        onClick={() => currentIdx < branches.length - 1 && handleSwitch(branches[currentIdx + 1])}
        disabled={currentIdx >= branches.length - 1}
        style={{
          background: 'none', border: 'none',
          color: currentIdx < branches.length - 1 ? '#4fc3f7' : '#333',
          cursor: currentIdx < branches.length - 1 ? 'pointer' : 'default', fontSize: 12, padding: 0,
        }}
      >&gt;</button>
    </div>
  )
}

const mdComponents = {
  p: ({ children }: any) => <p style={{ margin: '4px 0' }}>{children}</p>,
  h1: ({ children }: any) => <h1 style={{ fontSize: 18, fontWeight: 700, margin: '8px 0 4px', color: '#e0e0e0' }}>{children}</h1>,
  h2: ({ children }: any) => <h2 style={{ fontSize: 16, fontWeight: 700, margin: '8px 0 4px', color: '#e0e0e0' }}>{children}</h2>,
  h3: ({ children }: any) => <h3 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 3px', color: '#e0e0e0' }}>{children}</h3>,
  h4: ({ children }: any) => <h4 style={{ fontSize: 13, fontWeight: 600, margin: '6px 0 3px', color: '#d0d0d0' }}>{children}</h4>,
  ul: ({ children }: any) => <ul style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }: any) => <ol style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }: any) => <li style={{ margin: '2px 0' }}>{children}</li>,
  code: ({ className, children, ...props }: any) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <pre style={{
          background: '#0d0d1a', borderRadius: 6, padding: '8px 10px',
          overflow: 'auto', margin: '6px 0', border: '1px solid #2a2a3e',
        }}>
          <code style={{ fontSize: 11, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: '#c8d0e0' }}>
            {children}
          </code>
        </pre>
      )
    }
    return (
      <code style={{
        background: '#1e1e32', padding: '1px 5px', borderRadius: 3,
        fontSize: 11, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: '#c8d0e0',
      }} {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children }: any) => <>{children}</>,
  blockquote: ({ children }: any) => (
    <blockquote style={{
      borderLeft: '3px solid #4fc3f7', paddingLeft: 10, margin: '6px 0',
      color: '#aaa', fontStyle: 'italic',
    }}>
      {children}
    </blockquote>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '8px 0' }} />,
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ color: '#4fc3f7', textDecoration: 'none' }}
      onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
      onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
    >
      {children}
    </a>
  ),
  table: ({ children }: any) => (
    <div style={{ overflow: 'auto', margin: '6px 0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>{children}</table>
    </div>
  ),
  th: ({ children }: any) => (
    <th style={{ border: '1px solid #333', padding: '4px 8px', background: '#1a1a2e', fontWeight: 600, textAlign: 'left' }}>{children}</th>
  ),
  td: ({ children }: any) => (
    <td style={{ border: '1px solid #2a2a3e', padding: '4px 8px' }}>{children}</td>
  ),
  strong: ({ children }: any) => <strong style={{ color: '#e0e0e0', fontWeight: 600 }}>{children}</strong>,
  em: ({ children }: any) => <em style={{ color: '#bbb' }}>{children}</em>,
}

function MessageBubble({ message, isStreaming, onEdit }: { message: any; isStreaming?: boolean; onEdit?: () => void }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isToolCall = message.role === 'tool_call'

  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content, null, 2)

  const bg = isUser ? '#1e3a5f' : isSystem ? '#3e1e1e' : isToolCall ? '#1e2e1e' : 'transparent'
  const color = isUser ? '#8bb8e8' : isSystem ? '#e88b8b' : isToolCall ? '#8be88b' : '#ccc'

  return (
    <div style={{
      margin: '4px 0',
      padding: isUser || isSystem || isToolCall ? '6px 10px' : '2px 0',
      borderRadius: 8,
      fontSize: 12,
      lineHeight: 1.6,
      wordBreak: 'break-word',
      background: bg,
      color,
      borderLeft: isToolCall ? '3px solid #66bb6a' : 'none',
      position: 'relative',
    }}>
      {isToolCall && (
        <div style={{ fontSize: 10, color: '#66bb6a', marginBottom: 2, fontWeight: 600 }}>
          Tool: {message.tool_name}
        </div>
      )}
      {isUser || isSystem || isToolCall ? (
        <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>
      ) : (
        <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {content}
        </Markdown>
      )}
      {isStreaming && <span style={{ color: '#4fc3f7' }}>|</span>}
      {onEdit && (
        <button
          onClick={onEdit}
          style={{
            position: 'absolute', top: 4, right: 4,
            background: 'none', border: 'none', color: '#555', cursor: 'pointer',
            fontSize: 10, padding: '0 4px', opacity: 0.6,
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
          title="Edit & fork"
        >
          Edit
        </button>
      )}
    </div>
  )
}
