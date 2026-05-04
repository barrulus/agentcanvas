import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useSelector } from 'react-redux'
import type { RootState } from '@/shared/state/store'
import { AgentCard } from '../AgentCard'
import { InputCardComponent } from '../InputCardComponent'
import { ViewCardComponent } from '../ViewCardComponent'
import { GateCardComponent } from '../GateCardComponent'
import { MergeCardComponent } from '../MergeCardComponent'
import { DialogueCardComponent } from '../DialogueCardComponent'
import { GroupNode } from './groups'

const handleStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  background: '#4fc3f7',
  border: '2px solid #1a1a2e',
}

function CardWrapper({ id, render }: { id: string; render: (card: any) => React.ReactNode }) {
  const card = useSelector((s: RootState) => s.canvas.cards[id])
  if (!card) return null
  return (
    <>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      {render(card)}
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </>
  )
}

export function AgentNode({ id }: NodeProps) {
  return <CardWrapper id={id} render={(c) => <AgentCard card={c} chromeless />} />
}

export function ViewNode({ id }: NodeProps) {
  return <CardWrapper id={id} render={(c) => <ViewCardComponent card={c} chromeless />} />
}

export function InputNode({ id }: NodeProps) {
  return <CardWrapper id={id} render={(c) => <InputCardComponent card={c} chromeless />} />
}

export function GateNode({ id }: NodeProps) {
  return <CardWrapper id={id} render={(c) => <GateCardComponent card={c} chromeless />} />
}

export function MergeNode({ id }: NodeProps) {
  return <CardWrapper id={id} render={(c) => <MergeCardComponent card={c} chromeless />} />
}

export function DialogueNode({ id }: NodeProps) {
  return <CardWrapper id={id} render={(c) => <DialogueCardComponent card={c} chromeless />} />
}

export const nodeTypes = {
  agentCard: AgentNode,
  viewCard: ViewNode,
  inputCard: InputNode,
  gateCard: GateNode,
  mergeCard: MergeNode,
  dialogueCard: DialogueNode,
  groupCard: GroupNode,
}
