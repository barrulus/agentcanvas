import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system'
  content: any
  timestamp: number
  tool_name?: string
  tool_call_id?: string
}

interface AgentSession {
  id: string
  name: string
  provider_id: string
  model: string
  status: string
  messages: Message[]
  cost_usd: number
  tokens: { input: number; output: number }
  created_at: number
  parent_session_id?: string | null
  streamingMessage: { id: string; role: string; content: string; tool_name?: string } | null
  pendingApproval?: {
    approvalId: string
    toolName: string
    arguments: any
  } | null
}

interface AgentsState {
  sessions: Record<string, AgentSession>
  providers: Array<{ id: string; name: string; manages_own_tools: boolean }>
  history: AgentSession[]
}

const initialState: AgentsState = {
  sessions: {},
  providers: [],
  history: [],
}

export const fetchSessions = createAsyncThunk('agents/fetchSessions', async (dashboardId?: string) => {
  const url = dashboardId ? `/api/sessions?dashboard_id=${dashboardId}` : '/api/sessions'
  const res = await fetch(url)
  const data = await res.json()
  return data.sessions as AgentSession[]
})

export const fetchHistory = createAsyncThunk('agents/fetchHistory', async (search?: string) => {
  const url = search ? `/api/sessions/history?search=${encodeURIComponent(search)}` : '/api/sessions/history'
  const res = await fetch(url)
  const data = await res.json()
  return data.sessions as AgentSession[]
})

export const fetchProviders = createAsyncThunk('agents/fetchProviders', async () => {
  const res = await fetch('/api/providers')
  const data = await res.json()
  return data.providers
})

export const fetchModels = createAsyncThunk('agents/fetchModels', async (providerId: string) => {
  const res = await fetch(`/api/providers/${providerId}/models`)
  const data = await res.json()
  return { providerId, models: data.models }
})

export const createSession = createAsyncThunk(
  'agents/createSession',
  async (params: { provider_id: string; model: string; name?: string; system_prompt?: string }) => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return await res.json()
  }
)

const agentsSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    setSession(state, action: PayloadAction<AgentSession>) {
      state.sessions[action.payload.id] = action.payload
    },
    updateStatus(state, action: PayloadAction<{ sessionId: string; status: string; session?: AgentSession }>) {
      const s = state.sessions[action.payload.sessionId]
      if (s) {
        s.status = action.payload.status
        if (action.payload.session) {
          state.sessions[action.payload.sessionId] = action.payload.session
        }
      }
    },
    addMessage(state, action: PayloadAction<{ sessionId: string; message: Message }>) {
      const s = state.sessions[action.payload.sessionId]
      if (s) {
        // Don't duplicate messages
        if (!s.messages.find(m => m.id === action.payload.message.id)) {
          s.messages.push(action.payload.message)
        }
        s.streamingMessage = null
      }
    },
    streamStart(state, action: PayloadAction<{ sessionId: string; messageId: string; role: string; toolName?: string }>) {
      const s = state.sessions[action.payload.sessionId]
      if (s) {
        s.streamingMessage = {
          id: action.payload.messageId,
          role: action.payload.role,
          content: '',
          tool_name: action.payload.toolName,
        }
      }
    },
    streamDelta(state, action: PayloadAction<{ sessionId: string; messageId: string; delta: string }>) {
      const s = state.sessions[action.payload.sessionId]
      if (s?.streamingMessage?.id === action.payload.messageId) {
        s.streamingMessage.content += action.payload.delta
      }
    },
    streamEnd(state, action: PayloadAction<{ sessionId: string; messageId: string }>) {
      const s = state.sessions[action.payload.sessionId]
      if (s) {
        s.streamingMessage = null
      }
    },
    updateCost(state, action: PayloadAction<{ sessionId: string; cost_usd: number; tokens: { input: number; output: number } }>) {
      const s = state.sessions[action.payload.sessionId]
      if (s) {
        s.cost_usd = action.payload.cost_usd
        s.tokens = action.payload.tokens
      }
    },
    removeSession(state, action: PayloadAction<string>) {
      delete state.sessions[action.payload]
    },
    setApprovalRequest(state, action: PayloadAction<{ sessionId: string; approvalId: string; toolName: string; arguments: any }>) {
      const s = state.sessions[action.payload.sessionId]
      if (s) {
        s.pendingApproval = {
          approvalId: action.payload.approvalId,
          toolName: action.payload.toolName,
          arguments: action.payload.arguments,
        }
      }
    },
    clearApprovalRequest(state, action: PayloadAction<string>) {
      const s = state.sessions[action.payload]
      if (s) {
        s.pendingApproval = null
      }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchProviders.fulfilled, (state, action) => {
      state.providers = action.payload
    })
    builder.addCase(createSession.fulfilled, (state, action) => {
      state.sessions[action.payload.id] = { ...action.payload, streamingMessage: null }
    })
    builder.addCase(fetchSessions.fulfilled, (state, action) => {
      for (const s of action.payload) {
        state.sessions[s.id] = { ...s, streamingMessage: null }
      }
    })
    builder.addCase(fetchHistory.fulfilled, (state, action) => {
      state.history = action.payload
    })
  },
})

export const { setSession, updateStatus, addMessage, streamStart, streamDelta, streamEnd, updateCost, removeSession, setApprovalRequest, clearApprovalRequest } = agentsSlice.actions
export const agentsReducer = agentsSlice.reducer
