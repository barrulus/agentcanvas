import { useCallback } from 'react'
import { useDispatch } from 'react-redux'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { AppDispatch } from '@/shared/state/store'
import { toggleGroupCollapsed, deleteGroup, renameGroup, moveGroup } from '@/shared/state/canvasSlice'

const COLLAPSED_W = 200
const COLLAPSED_H = 48
const HEADER_H = 28
const PAD = 16

export type GroupNodeData = {
  groupId: string
  collapsed: boolean
  name: string
  color?: string
  memberCount: number
}

export function GroupNode({ data }: NodeProps) {
  const dispatch = useDispatch<AppDispatch>()
  const { groupId, collapsed, name, color, memberCount } = data as GroupNodeData

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    let lastX = e.clientX
    let lastY = e.clientY
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - lastX
      const dy = ev.clientY - lastY
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        // dx/dy here are screen pixels; translate to canvas-space using xyflow's transform attr
        const flowEl = (ev.target as HTMLElement)?.closest('.react-flow') as HTMLElement | null
        const transformEl = flowEl?.querySelector('.react-flow__viewport') as HTMLElement | null
        const matrix = transformEl ? new DOMMatrixReadOnly(getComputedStyle(transformEl).transform) : null
        const z = matrix && matrix.a ? matrix.a : 1
        dispatch(moveGroup({ groupId, dx: dx / z, dy: dy / z }))
        lastX = ev.clientX
        lastY = ev.clientY
      }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [dispatch, groupId])

  const onRename = useCallback(() => {
    const next = window.prompt('Group name:', name)
    if (next?.trim()) dispatch(renameGroup({ id: groupId, name: next.trim() }))
  }, [dispatch, groupId, name])

  if (collapsed) {
    return (
      <div
        onMouseDown={onHeaderMouseDown}
        style={{
          width: COLLAPSED_W,
          height: COLLAPSED_H,
          background: '#1a1a2e',
          border: `2px dashed ${color || '#666'}`,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 8,
          cursor: 'grab',
          userSelect: 'none',
          position: 'relative',
        }}
      >
        <Handle type="target" position={Position.Left} style={{ width: 10, height: 10, background: '#4fc3f7', border: '2px solid #1a1a2e' }} />
        <Handle type="source" position={Position.Right} style={{ width: 10, height: 10, background: '#4fc3f7', border: '2px solid #1a1a2e' }} />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); dispatch(toggleGroupCollapsed(groupId)) }}
          style={{ background: 'none', border: 'none', color: '#4fc3f7', cursor: 'pointer', fontSize: 14 }}
          title="Expand group"
        >
          &#9654;
        </button>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ fontSize: 10, color: '#666' }}>{memberCount} cards</span>
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: `2px dashed ${color || '#444'}`,
        borderRadius: 12,
        pointerEvents: 'none',
        position: 'relative',
      }}
    >
      <div
        onMouseDown={onHeaderMouseDown}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: HEADER_H,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          gap: 6,
          pointerEvents: 'auto',
          cursor: 'grab',
          userSelect: 'none',
        }}
      >
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); dispatch(toggleGroupCollapsed(groupId)) }}
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 10, padding: 0 }}
          title="Collapse group"
        >
          &#9660;
        </button>
        <span
          onDoubleClick={onRename}
          style={{ fontSize: 11, fontWeight: 600, color: '#888', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title="Double-click to rename"
        >
          {name}
        </span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); dispatch(deleteGroup(groupId)) }}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, padding: 0 }}
          title="Ungroup"
        >
          x
        </button>
      </div>
    </div>
  )
}

export const GROUP_LAYOUT = { COLLAPSED_W, COLLAPSED_H, HEADER_H, PAD }
