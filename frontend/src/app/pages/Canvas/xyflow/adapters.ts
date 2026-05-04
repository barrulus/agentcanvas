import { MarkerType, type Node, type Edge, type NodeChange, type EdgeChange, type Connection as XYConnection } from '@xyflow/react'
import type { Dispatch } from '@reduxjs/toolkit'
import type { RootState } from '@/shared/state/store'
import type { WorkflowRun } from '@/shared/state/runsSlice'
import {
  moveCard,
  removeCard,
  removeConnection,
  addConnection,
  setSelected,
} from '@/shared/state/canvasSlice'
import { GROUP_LAYOUT, type GroupNodeData } from './groups'

type CanvasState = RootState['canvas']

export type CardNodeData = {
  cardType: 'agent' | 'view' | 'input' | 'gate' | 'dialogue' | 'merge'
  collapsed: boolean
  zOrder: number
  groupId?: string
  // run overlay (set when an active run is selected)
  runStatus?: 'running' | 'completed' | 'error' | 'stopped'
  runCost?: number
  runTokens?: number
  runError?: string | null
  runDurationMs?: number
  notInRun?: boolean
}

export type AgentEdgeData = {
  condition?: string
  output_schema?: Record<string, unknown>
  transform?: string
  gate_rule?: string
  blockedReason?: string
  // run overlay
  firedInRun?: boolean
}

export type CardNode = Node<CardNodeData>
export type GroupNode = Node<GroupNodeData>
export type AnyNode = CardNode | GroupNode
export type AgentEdge = Edge<AgentEdgeData>

const COLLAPSED_W = 240
const COLLAPSED_H = 56

function effectiveSize(card: CanvasState['cards'][string]): { width: number; height: number } {
  if (card.collapsed) return { width: COLLAPSED_W, height: COLLAPSED_H }
  return { width: card.width, height: card.height }
}

export function selectNodes(state: CanvasState, activeRun?: WorkflowRun | null): AnyNode[] {
  const groupOf: Record<string, string> = {}
  const collapsedHidden = new Set<string>()
  for (const g of Object.values(state.groups)) {
    for (const memberId of g.memberIds) {
      groupOf[memberId] = g.id
      if (g.collapsed) collapsedHidden.add(memberId)
    }
  }

  // Build a card_id → CardRunRecord lookup once per call.
  const runByCardId: Record<string, NonNullable<typeof activeRun>['card_runs'][number]> = {}
  if (activeRun) {
    for (const cr of activeRun.card_runs) {
      runByCardId[cr.card_id] = cr
    }
  }

  const cardNodes: CardNode[] = Object.values(state.cards)
    .filter((c) => !collapsedHidden.has(c.session_id))
    .map((card) => {
      const { width, height } = effectiveSize(card)
      const cr = activeRun ? runByCardId[card.session_id] : undefined
      const overlayFields: Partial<CardNodeData> = activeRun
        ? cr
          ? {
              runStatus: cr.status,
              runCost: cr.cost_usd,
              runTokens: cr.tokens,
              runError: cr.error_text,
              runDurationMs: cr.ended_at && cr.started_at
                ? Math.round((cr.ended_at - cr.started_at) * 1000)
                : undefined,
            }
          : { notInRun: true }
        : {}
      return {
        id: card.session_id,
        type: `${card.card_type ?? 'agent'}Card`,
        position: { x: card.x, y: card.y },
        width,
        height,
        zIndex: 10 + card.zOrder,
        selected: state.selectedCards.includes(card.session_id),
        data: {
          cardType: card.card_type ?? 'agent',
          collapsed: !!card.collapsed,
          zOrder: card.zOrder,
          groupId: groupOf[card.session_id],
          ...overlayFields,
        },
      }
    })

  const groupNodes: GroupNode[] = []
  for (const g of Object.values(state.groups)) {
    const members = g.memberIds.map((id) => state.cards[id]).filter(Boolean)
    if (members.length === 0) continue

    if (g.collapsed) {
      const first = members[0]
      groupNodes.push({
        id: `group:${g.id}`,
        type: 'groupCard',
        position: { x: first.x, y: first.y },
        width: GROUP_LAYOUT.COLLAPSED_W,
        height: GROUP_LAYOUT.COLLAPSED_H,
        zIndex: 5,
        draggable: false,
        selectable: false,
        data: {
          groupId: g.id,
          collapsed: true,
          name: g.name,
          color: g.color,
          memberCount: g.memberIds.length,
        },
      })
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const c of members) {
        const { width, height } = effectiveSize(c)
        minX = Math.min(minX, c.x)
        minY = Math.min(minY, c.y)
        maxX = Math.max(maxX, c.x + width)
        maxY = Math.max(maxY, c.y + height)
      }
      const pad = GROUP_LAYOUT.PAD
      groupNodes.push({
        id: `group:${g.id}`,
        type: 'groupCard',
        position: { x: minX - pad, y: minY - pad - GROUP_LAYOUT.HEADER_H },
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2 + GROUP_LAYOUT.HEADER_H,
        zIndex: 0,
        draggable: false,
        selectable: false,
        data: {
          groupId: g.id,
          collapsed: false,
          name: g.name,
          color: g.color,
          memberCount: g.memberIds.length,
        },
      })
    }
  }

  return [...groupNodes, ...cardNodes]
}

export function selectEdges(state: CanvasState, activeRun?: WorkflowRun | null): AgentEdge[] {
  // Map: card-in-collapsed-group → synthetic group node id (so we can rewrite endpoints)
  const collapsedMemberGroup: Record<string, string> = {}
  for (const g of Object.values(state.groups)) {
    if (!g.collapsed) continue
    const groupNodeId = `group:${g.id}`
    for (const mid of g.memberIds) collapsedMemberGroup[mid] = groupNodeId
  }

  // Build a set of edge ids that fired in the active run.
  const firedEdgeIds = new Set<string>()
  if (activeRun) {
    for (const cr of activeRun.card_runs) {
      for (const eid of cr.routes_taken) firedEdgeIds.add(eid)
    }
  }

  const seen = new Set<string>()
  const edges: AgentEdge[] = []
  for (const c of state.connections) {
    if (!c.id) continue
    const sourceGroup = collapsedMemberGroup[c.from]
    const targetGroup = collapsedMemberGroup[c.to]
    // Both endpoints inside the same collapsed group → hide
    if (sourceGroup && targetGroup && sourceGroup === targetGroup) continue
    const source = sourceGroup ?? c.from
    const target = targetGroup ?? c.to
    // Dedupe: multiple raw connections may collapse to the same group endpoint pair
    const dedupeKey = `${source}::${target}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const blockedReason = state.blockedConnections[c.id]
    const hasContract = !!(c.output_schema || c.transform || c.gate_rule)
    const arrowColor = blockedReason
      ? '#ef5350'
      : hasContract
        ? '#b39ddb'
        : c.condition
          ? '#ffa726'
          : '#4fc3f7'
    edges.push({
      id: c.id,
      source,
      target,
      type: 'agentEdge',
      markerEnd: { type: MarkerType.ArrowClosed, color: arrowColor, width: 18, height: 18 },
      data: {
        condition: c.condition,
        output_schema: c.output_schema,
        transform: c.transform,
        gate_rule: c.gate_rule,
        blockedReason,
        firedInRun: activeRun ? firedEdgeIds.has(c.id) : undefined,
      },
    })
  }
  return edges
}

export function applyNodesChange(dispatch: Dispatch, changes: NodeChange[]): void {
  const positionEnds: Array<{ id: string; x: number; y: number }> = []
  const removed: string[] = []
  let selectionChanged = false
  let nextSelected: string[] | null = null

  for (const change of changes) {
    if (change.type === 'position' && change.dragging === false && change.position) {
      positionEnds.push({ id: change.id, x: change.position.x, y: change.position.y })
    } else if (change.type === 'remove') {
      removed.push(change.id)
    } else if (change.type === 'select') {
      selectionChanged = true
    }
  }

  if (positionEnds.length === 1) {
    const p = positionEnds[0]
    dispatch(moveCard({ sessionId: p.id, x: p.x, y: p.y }))
  } else if (positionEnds.length > 1) {
    for (const p of positionEnds) {
      dispatch(moveCard({ sessionId: p.id, x: p.x, y: p.y }))
    }
  }

  for (const id of removed) dispatch(removeCard(id))

  if (selectionChanged) {
    nextSelected = changes
      .filter((c) => c.type === 'select' && c.selected)
      .map((c) => (c as Extract<NodeChange, { type: 'select' }>).id)
    if (nextSelected) dispatch(setSelected(nextSelected))
  }
}

export function applyEdgesChange(dispatch: Dispatch, changes: EdgeChange[]): void {
  for (const change of changes) {
    if (change.type === 'remove') {
      dispatch(removeConnection(change.id))
    }
  }
}

export function onConnect(dispatch: Dispatch, conn: XYConnection): void {
  if (!conn.source || !conn.target || conn.source === conn.target) return
  dispatch(addConnection({ from: conn.source, to: conn.target }))
}

export function onReconnect(
  dispatch: Dispatch,
  oldEdge: { id: string },
  conn: XYConnection,
): void {
  if (!conn.source || !conn.target || conn.source === conn.target) return
  dispatch(removeConnection(oldEdge.id))
  dispatch(addConnection({ from: conn.source, to: conn.target }))
}

export function onSelectionChange(dispatch: Dispatch, params: { nodes: Node[] }): void {
  dispatch(setSelected(params.nodes.map((n) => n.id)))
}
