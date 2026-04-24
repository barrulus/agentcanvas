import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

interface MCPServer {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  callback_port?: number | null
  oauth_client_id?: string | null
  oauth_scopes?: string[]
  oauth_client?: unknown
  oauth_tokens?: { access_token: string; expires_at?: number | null } | null
  env?: Record<string, string>
  enabled: boolean
}

interface ToolSchema {
  name: string
  qualified_name: string
  description: string
  input_schema: any
  server_id: string
  server_name: string
}

interface MCPState {
  servers: MCPServer[]
  tools: Record<string, ToolSchema[]>  // server_id -> tools
  permissions: Record<string, string>   // qualified_name -> policy
  loading: boolean
  discoveringId: string | null
  errorsById: Record<string, string>
}

const initialState: MCPState = {
  servers: [],
  tools: {},
  permissions: {},
  loading: false,
  discoveringId: null,
  errorsById: {},
}

export const fetchServers = createAsyncThunk('mcp/fetchServers', async () => {
  const res = await fetch('/api/mcp-servers')
  const data = await res.json()
  return data.servers as MCPServer[]
})

export const createServer = createAsyncThunk('mcp/createServer', async (server: Partial<MCPServer>) => {
  const res = await fetch('/api/mcp-servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(server),
  })
  return await res.json() as MCPServer
})

export const updateServer = createAsyncThunk('mcp/updateServer', async ({ id, updates }: { id: string; updates: Partial<MCPServer> }) => {
  const res = await fetch(`/api/mcp-servers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  return await res.json() as MCPServer
})

export const deleteServer = createAsyncThunk('mcp/deleteServer', async (id: string, { rejectWithValue }) => {
  const res = await fetch(`/api/mcp-servers/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return rejectWithValue(body || `HTTP ${res.status}`)
  }
  return id
})

export const discoverTools = createAsyncThunk(
  'mcp/discoverTools',
  async (serverId: string, { rejectWithValue }) => {
    // OAuth browser round-trip can take a while; extend tolerance here.
    const res = await fetch(`/api/mcp-servers/${serverId}/tools`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return rejectWithValue({ serverId, error: data?.error || `HTTP ${res.status}` })
    }
    return { serverId, tools: data.tools as ToolSchema[] }
  }
)

export const fetchPermissions = createAsyncThunk('mcp/fetchPermissions', async () => {
  const res = await fetch('/api/permissions')
  const data = await res.json()
  return data.permissions as Record<string, string>
})

export const setPermission = createAsyncThunk('mcp/setPermission', async ({ toolName, policy }: { toolName: string; policy: string }) => {
  await fetch('/api/permissions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions: { [toolName]: policy } }),
  })
  return { toolName, policy }
})

const mcpSlice = createSlice({
  name: 'mcp',
  initialState,
  reducers: {
    clearServerError(state, action: { payload: string }) {
      delete state.errorsById[action.payload]
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchServers.fulfilled, (state, action) => { state.servers = action.payload })
      .addCase(createServer.fulfilled, (state, action) => { state.servers.push(action.payload) })
      .addCase(updateServer.fulfilled, (state, action) => {
        const idx = state.servers.findIndex(s => s.id === action.payload.id)
        if (idx >= 0) state.servers[idx] = action.payload
      })
      .addCase(deleteServer.fulfilled, (state, action) => {
        state.servers = state.servers.filter(s => s.id !== action.payload)
        delete state.tools[action.payload]
        delete state.errorsById[action.payload]
      })
      .addCase(deleteServer.rejected, (state, action) => {
        const id = action.meta.arg
        state.errorsById[id] = `Delete failed: ${action.payload || action.error.message || ''}`
      })
      .addCase(discoverTools.pending, (state, action) => {
        state.discoveringId = action.meta.arg
        delete state.errorsById[action.meta.arg]
      })
      .addCase(discoverTools.fulfilled, (state, action) => {
        state.discoveringId = null
        state.tools[action.payload.serverId] = action.payload.tools
      })
      .addCase(discoverTools.rejected, (state, action) => {
        state.discoveringId = null
        const payload = action.payload as { serverId: string; error: string } | undefined
        if (payload) state.errorsById[payload.serverId] = payload.error
        else state.errorsById[action.meta.arg] = action.error.message || 'Discovery failed'
      })
      .addCase(fetchPermissions.fulfilled, (state, action) => { state.permissions = action.payload })
      .addCase(setPermission.fulfilled, (state, action) => {
        state.permissions[action.payload.toolName] = action.payload.policy
      })
  },
})

export const { clearServerError } = mcpSlice.actions

export const mcpReducer = mcpSlice.reducer
