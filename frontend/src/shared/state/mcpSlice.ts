import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

interface MCPServer {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
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
}

const initialState: MCPState = {
  servers: [],
  tools: {},
  permissions: {},
  loading: false,
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

export const deleteServer = createAsyncThunk('mcp/deleteServer', async (id: string) => {
  await fetch(`/api/mcp-servers/${id}`, { method: 'DELETE' })
  return id
})

export const discoverTools = createAsyncThunk('mcp/discoverTools', async (serverId: string) => {
  const res = await fetch(`/api/mcp-servers/${serverId}/tools`)
  const data = await res.json()
  return { serverId, tools: data.tools as ToolSchema[] }
})

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
  reducers: {},
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
      })
      .addCase(discoverTools.fulfilled, (state, action) => {
        state.tools[action.payload.serverId] = action.payload.tools
      })
      .addCase(fetchPermissions.fulfilled, (state, action) => { state.permissions = action.payload })
      .addCase(setPermission.fulfilled, (state, action) => {
        state.permissions[action.payload.toolName] = action.payload.policy
      })
  },
})

export const mcpReducer = mcpSlice.reducer
