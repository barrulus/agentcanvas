import { useRef, useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { clearApprovalRequest } from '@/shared/state/agentsSlice'
import { wsManager } from '@/shared/ws/WebSocketManager'
import { ApprovalBar } from './ApprovalBar'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function AgentChat({ sessionId }: { sessionId: string }) {
  const dispatch = useDispatch<AppDispatch>()
  const session = useSelector((s: RootState) => s.agents.sessions[sessionId])
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [session?.messages, session?.streamingMessage])

  if (!session) return null

  const handleSend = () => {
    if (!input.trim()) return
    wsManager.sendMessage(sessionId, input)
    setInput('')
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
        {session.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
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

      <div style={{ padding: 8, borderTop: '1px solid #222', display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }}}
          placeholder="Send a message..."
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

function MessageBubble({ message, isStreaming }: { message: any; isStreaming?: boolean }) {
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
    </div>
  )
}
