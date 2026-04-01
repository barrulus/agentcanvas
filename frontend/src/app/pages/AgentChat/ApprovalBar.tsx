import { useState } from 'react'

interface ApprovalBarProps {
  approvalId: string
  toolName: string
  arguments: any
  onApprove: () => void
  onDeny: () => void
}

export function ApprovalBar({ approvalId: _approvalId, toolName, arguments: args, onApprove, onDeny }: ApprovalBarProps) {
  const [expanded, setExpanded] = useState(false)

  const argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2)

  return (
    <div style={{
      background: '#3e3518',
      border: '1px solid #d4a017',
      borderRadius: 8,
      padding: '10px 14px',
      margin: '0 8px 8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14 }}>&#9888;</span>
        <span style={{ fontSize: 12, color: '#f5d68a', flex: 1 }}>
          Tool approval required: <strong style={{ color: '#ffd54f' }}>{toolName}</strong>
        </span>
        <button
          onClick={onApprove}
          style={{
            padding: '4px 12px',
            background: '#388e3c',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Approve
        </button>
        <button
          onClick={onDeny}
          style={{
            padding: '4px 12px',
            background: '#d32f2f',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Deny
        </button>
      </div>

      {argsStr && argsStr !== '{}' && argsStr !== 'null' && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#d4a017',
              fontSize: 11,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {expanded ? '▼' : '▶'} Arguments
          </button>
          {expanded && (
            <pre style={{
              marginTop: 6,
              padding: '8px 10px',
              background: '#2a2510',
              borderRadius: 4,
              fontSize: 10,
              color: '#e0d8c0',
              overflow: 'auto',
              maxHeight: 200,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}>
              {argsStr}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
