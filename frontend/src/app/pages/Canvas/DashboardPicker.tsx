import { useEffect, useRef } from 'react'

export type DashboardNode = {
  id: string
  name: string
  children?: DashboardNode[]
}

export function DashboardPicker({
  nodes,
  currentId,
  open,
  onToggle,
  onClose,
  onSwitch,
  onNew,
  onRowContextMenu,
}: {
  nodes: DashboardNode[]
  currentId: string
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSwitch: (id: string) => void
  onNew: () => void
  onRowContextMenu: (id: string, x: number, y: number) => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const currentName = findName(nodes, currentId) || 'Pick dashboard'

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        onClick={onToggle}
        style={{
          padding: '6px 12px',
          background: 'transparent',
          color: '#e0e0e0',
          border: '1px solid #333',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 120,
          maxWidth: 280,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title="Switch dashboard"
      >
        <span style={{ color: '#888', fontSize: 10 }}>▾</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentName}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#1a1a2e',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 4,
            zIndex: 10000,
            minWidth: 220,
            maxHeight: 480,
            overflowY: 'auto',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          {nodes.map((node) => (
            <DashboardRow
              key={node.id}
              node={node}
              depth={0}
              currentId={currentId}
              onSwitch={onSwitch}
              onRowContextMenu={onRowContextMenu}
            />
          ))}
          <div style={{ height: 1, background: '#333', margin: '4px 0' }} />
          <button
            onClick={onNew}
            style={{
              ...rowBaseStyle,
              color: '#9fd9ff',
            }}
          >
            + New dashboard
          </button>
        </div>
      )}
    </div>
  )
}

function DashboardRow({
  node,
  depth,
  currentId,
  onSwitch,
  onRowContextMenu,
}: {
  node: DashboardNode
  depth: number
  currentId: string
  onSwitch: (id: string) => void
  onRowContextMenu: (id: string, x: number, y: number) => void
}) {
  const isActive = node.id === currentId
  return (
    <>
      <button
        onClick={() => onSwitch(node.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onRowContextMenu(node.id, e.clientX, e.clientY)
        }}
        style={{
          ...rowBaseStyle,
          paddingLeft: 8 + depth * 12,
          background: isActive ? '#1f3a5a' : 'transparent',
          color: isActive ? '#9fd9ff' : '#e0e0e0',
          fontWeight: isActive ? 600 : 400,
        }}
        title="Right-click for rename / delete"
      >
        <span style={{ width: 12, display: 'inline-block', color: isActive ? '#9fd9ff' : 'transparent' }}>✓</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
      </button>
      {node.children?.map((child) => (
        <DashboardRow
          key={child.id}
          node={child}
          depth={depth + 1}
          currentId={currentId}
          onSwitch={onSwitch}
          onRowContextMenu={onRowContextMenu}
        />
      ))}
    </>
  )
}

function findName(nodes: DashboardNode[], id: string): string | null {
  for (const n of nodes) {
    if (n.id === id) return n.name
    if (n.children) {
      const child = findName(n.children, id)
      if (child) return child
    }
  }
  return null
}

const rowBaseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '6px 8px',
  background: 'transparent',
  color: '#e0e0e0',
  border: 'none',
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}
