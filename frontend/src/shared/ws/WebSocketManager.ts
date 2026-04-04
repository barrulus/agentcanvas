import { store } from '../state/store'
import { updateStatus, addMessage, streamStart, streamDelta, streamEnd, updateCost, setSession, setApprovalRequest, setBranch } from '../state/agentsSlice'
import { placeCard, addConnection } from '../state/canvasSlice'
import { setViewCard } from '../state/viewCardsSlice'

class WebSocketManager {
  private ws: WebSocket | null = null
  private deltaBuffer = new Map<string, string>()
  private flushScheduled = false
  private url: string

  constructor() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.url = `${proto}//${window.location.host}/ws/dashboard`
  }

  connect() {
    this.ws = new WebSocket(this.url)
    this.ws.onmessage = (ev) => this.handleMessage(ev)
    this.ws.onclose = () => {
      setTimeout(() => this.connect(), 2000)
    }
    this.ws.onerror = () => {}
  }

  private handleMessage(ev: MessageEvent) {
    const msg = JSON.parse(ev.data)
    const { event, session_id, data } = msg

    switch (event) {
      case 'agent:status':
        store.dispatch(updateStatus({
          sessionId: data.session_id || session_id,
          status: data.status,
          session: data.session ? { ...data.session, streamingMessage: null } : undefined,
        }))
        break

      case 'agent:message':
        store.dispatch(addMessage({ sessionId: data.session_id || session_id, message: data.message }))
        break

      case 'agent:stream_start':
        this.flushDeltas()
        store.dispatch(streamStart({
          sessionId: data.session_id || session_id,
          messageId: data.message_id,
          role: data.role,
          toolName: data.tool_name,
        }))
        break

      case 'agent:stream_delta': {
        const key = `${data.session_id || session_id}:${data.message_id}`
        const existing = this.deltaBuffer.get(key) || ''
        this.deltaBuffer.set(key, existing + data.delta)
        this.scheduleFlush()
        break
      }

      case 'agent:stream_end':
        this.flushDeltas()
        store.dispatch(streamEnd({ sessionId: data.session_id || session_id, messageId: data.message_id }))
        break

      case 'agent:cost_update':
        store.dispatch(updateCost({
          sessionId: data.session_id || session_id,
          cost_usd: data.cost_usd,
          tokens: data.tokens,
        }))
        break

      case 'agent:approval_request':
        store.dispatch(setApprovalRequest({
          sessionId: data.session_id || session_id,
          approvalId: data.approval_id,
          toolName: data.tool_name,
          arguments: data.arguments,
        }))
        break

      case 'agent:branch_created':
      case 'agent:branch_switched':
        store.dispatch(setBranch({
          sessionId: data.session_id || session_id,
          branchId: data.branch_id,
          session: data.session ? { ...data.session, streamingMessage: null } : undefined,
        }))
        break

      case 'view_card:update':
        if (data.card) {
          store.dispatch(setViewCard(data.card))
        }
        break

      case 'flow:routed':
        // UI animation hook — could trigger a visual pulse on the connection
        // For now, just log. The downstream effects (agent running, view card updating)
        // are handled by their own events.
        break

      case 'agent:spawned': {
        const sid = data.session_id
        const parentSid = data.parent_session_id
        if (data.session) {
          store.dispatch(setSession({ ...data.session, streamingMessage: null }))
        }
        // Auto-place the child card near the parent
        const parentCard = store.getState().canvas.cards[parentSid]
        if (parentCard) {
          store.dispatch(placeCard({
            sessionId: sid,
            x: parentCard.x + parentCard.width + 120,
            y: parentCard.y,
          }))
        } else {
          store.dispatch(placeCard({ sessionId: sid }))
        }
        if (parentSid) {
          store.dispatch(addConnection({ from: parentSid, to: sid }))
        }
        break
      }
    }
  }

  private scheduleFlush() {
    if (!this.flushScheduled) {
      this.flushScheduled = true
      requestAnimationFrame(() => this.flushDeltas())
    }
  }

  private flushDeltas() {
    this.flushScheduled = false
    for (const [key, delta] of this.deltaBuffer) {
      const [sessionId, messageId] = key.split(':')
      store.dispatch(streamDelta({ sessionId, messageId, delta }))
    }
    this.deltaBuffer.clear()
  }

  send(event: string, data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }))
    }
  }

  sendMessage(sessionId: string, content: string) {
    this.send('agent:send_message', { session_id: sessionId, content })
  }

  stopAgent(sessionId: string) {
    this.send('agent:stop', { session_id: sessionId })
  }

  sendApprovalResponse(approvalId: string, approved: boolean) {
    this.send('agent:approval_response', { approval_id: approvalId, approved })
  }
}

export const wsManager = new WebSocketManager()
