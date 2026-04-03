import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

export interface AgentMode {
  id: string
  name: string
  slug: string
  description?: string | null
  system_prompt?: string | null
  tool_restrictions?: string[] | null
  is_builtin: boolean
  icon?: string | null
  created_at: number
}

interface ModesState {
  modes: AgentMode[]
  loading: boolean
}

const initialState: ModesState = {
  modes: [],
  loading: false,
}

export const fetchModes = createAsyncThunk('modes/fetchModes', async () => {
  const res = await fetch('/api/modes')
  const data = await res.json()
  return data.modes as AgentMode[]
})

export const createMode = createAsyncThunk('modes/createMode', async (mode: Partial<AgentMode>) => {
  const res = await fetch('/api/modes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mode),
  })
  return await res.json() as AgentMode
})

export const deleteMode = createAsyncThunk('modes/deleteMode', async (modeId: string) => {
  await fetch(`/api/modes/${modeId}`, { method: 'DELETE' })
  return modeId
})

const modesSlice = createSlice({
  name: 'modes',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(fetchModes.pending, (state) => { state.loading = true })
    builder.addCase(fetchModes.fulfilled, (state, action) => {
      state.modes = action.payload
      state.loading = false
    })
    builder.addCase(createMode.fulfilled, (state, action) => {
      state.modes.push(action.payload)
    })
    builder.addCase(deleteMode.fulfilled, (state, action) => {
      state.modes = state.modes.filter(m => m.id !== action.payload)
    })
  },
})

export const modesReducer = modesSlice.reducer
