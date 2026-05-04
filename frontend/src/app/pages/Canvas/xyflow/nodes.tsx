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
import type { CardNodeData } from './adapters'

export type RunOverlay = {
  runStatus?: 'running' | 'completed' | 'error' | 'stopped'
  runCost?: number
  runTokens?: number
  runError?: string | null
  runDurationMs?: number
  notInRun?: boolean
}

function extractOverlay(data: CardNodeData | undefined): RunOverlay | undefined {
  if (!data) return undefined
  const { runStatus, runCost, runTokens, runError, runDurationMs, notInRun } = data
  if (runStatus === undefined && !notInRun) return undefined
  return { runStatus, runCost, runTokens, runError, runDurationMs, notInRun }
}

const handleStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  background: '#4fc3f7',
  border: '2px solid #1a1a2e',
}

function CardWrapper({
  id,
  data,
  render,
}: {
  id: string
  data?: CardNodeData
  render: (card: any, overlay?: RunOverlay) => React.ReactNode
}) {
  const card = useSelector((s: RootState) => s.canvas.cards[id])
  if (!card) return null
  const overlay = extractOverlay(data)
  return (
    <>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      {render(card, overlay)}
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </>
  )
}

export function AgentNode({ id, data }: NodeProps) {
  return <CardWrapper id={id} data={data as CardNodeData | undefined} render={(c, overlay) => <AgentCard card={c} chromeless overlay={overlay} />} />
}

export function ViewNode({ id, data }: NodeProps) {
  return <CardWrapper id={id} data={data as CardNodeData | undefined} render={(c, overlay) => <ViewCardComponent card={c} chromeless overlay={overlay} />} />
}

export function InputNode({ id, data }: NodeProps) {
  return <CardWrapper id={id} data={data as CardNodeData | undefined} render={(c, overlay) => <InputCardComponent card={c} chromeless overlay={overlay} />} />
}

export function GateNode({ id, data }: NodeProps) {
  return <CardWrapper id={id} data={data as CardNodeData | undefined} render={(c, overlay) => <GateCardComponent card={c} chromeless overlay={overlay} />} />
}

export function MergeNode({ id, data }: NodeProps) {
  return <CardWrapper id={id} data={data as CardNodeData | undefined} render={(c, overlay) => <MergeCardComponent card={c} chromeless overlay={overlay} />} />
}

export function DialogueNode({ id, data }: NodeProps) {
  return <CardWrapper id={id} data={data as CardNodeData | undefined} render={(c, overlay) => <DialogueCardComponent card={c} chromeless overlay={overlay} />} />
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
