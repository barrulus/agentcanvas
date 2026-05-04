import { useEffect, useRef, type ReactNode } from 'react'

export type AddCardItem = {
  key: string
  label: string
  hasDialog?: boolean
  icon?: ReactNode
  onSelect: () => void
}

export function AddCardMenu({
  items,
  open,
  onToggle,
  onClose,
}: {
  items: AddCardItem[]
  open: boolean
  onToggle: () => void
  onClose: () => void
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

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        onClick={onToggle}
        style={{
          padding: '6px 16px',
          background: '#4fc3f7',
          color: '#000',
          border: 'none',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
        title="Add a card to the canvas"
      >
        <span>+ Add</span>
        <span style={{ color: '#003a52', fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: '#1a1a2e',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 4,
            zIndex: 10000,
            minWidth: 200,
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              onClick={() => { it.onSelect(); onClose() }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 8px',
                background: 'transparent',
                color: '#e0e0e0',
                border: 'none',
                borderRadius: 4,
                fontSize: 12,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ width: 14, color: '#666', textAlign: 'center' }}>
                {it.icon ?? '◯'}
              </span>
              <span>{it.label}{it.hasDialog ? '…' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
