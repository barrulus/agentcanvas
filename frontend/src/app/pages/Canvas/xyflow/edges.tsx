import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { AgentEdge as AgentEdgeType } from './adapters'

export function AgentEdge(props: EdgeProps<AgentEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const condition = data?.condition
  const transform = data?.transform
  const outputSchema = data?.output_schema
  const gateRule = data?.gate_rule
  const blockedReason = data?.blockedReason

  const hasContract = !!(outputSchema || transform || gateRule)
  const isBlocked = !!blockedReason
  const color = isBlocked
    ? '#ef5350'
    : hasContract
      ? '#b39ddb'
      : condition
        ? '#ffa726'
        : '#4fc3f7'
  const dashArray = hasContract ? '8 4' : undefined

  const contractParts: string[] = []
  if (outputSchema) contractParts.push('schema')
  if (transform) contractParts.push('transform')
  if (gateRule) contractParts.push('gate')
  const contractLabel = contractParts.join(' + ')

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: color, strokeWidth: 3, strokeDasharray: dashArray, opacity: 0.9 }}
      />
      {/* Wider invisible hit-target for context-menu / click */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={20} className="react-flow__edge-interaction" />
      {(condition || (hasContract && !isBlocked) || isBlocked) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
              fontSize: 10,
              textAlign: 'center',
              lineHeight: 1.3,
              userSelect: 'none',
            }}
            className="nodrag nopan"
          >
            {condition && (
              <div style={{ color: '#ffa726', background: '#1a1a2eee', padding: '1px 6px', borderRadius: 3, marginBottom: 2 }}>
                {condition}
              </div>
            )}
            {hasContract && !isBlocked && contractLabel && (
              <div style={{ color: '#b39ddb', background: '#1a1a2eee', padding: '1px 6px', borderRadius: 3, fontSize: 9 }}>
                {contractLabel}
              </div>
            )}
            {isBlocked && (
              <div style={{ color: '#ef5350', background: '#1a1a2eee', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>
                BLOCKED: {blockedReason}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const edgeTypes = {
  agentEdge: AgentEdge,
}
