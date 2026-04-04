import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

export interface CommandPolicy {
  id: string
  pattern: string
  pattern_type: 'glob' | 'regex'
  action: 'allow' | 'deny' | 'ask'
  scope: 'global' | 'mode'
  scope_id?: string | null
  created_at: number
}

interface CommandPolicyState {
  policies: CommandPolicy[]
  loading: boolean
}

const initialState: CommandPolicyState = {
  policies: [],
  loading: false,
}

export const fetchPolicies = createAsyncThunk('commandPolicies/fetch', async () => {
  const res = await fetch('/api/command-policies')
  const data = await res.json()
  return data.policies as CommandPolicy[]
})

export const createPolicy = createAsyncThunk('commandPolicies/create', async (policy: Partial<CommandPolicy>) => {
  const res = await fetch('/api/command-policies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(policy),
  })
  return await res.json() as CommandPolicy
})

export const updatePolicy = createAsyncThunk('commandPolicies/update', async ({ id, ...updates }: Partial<CommandPolicy> & { id: string }) => {
  const res = await fetch(`/api/command-policies/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  return await res.json() as CommandPolicy
})

export const deletePolicy = createAsyncThunk('commandPolicies/delete', async (policyId: string) => {
  await fetch(`/api/command-policies/${policyId}`, { method: 'DELETE' })
  return policyId
})

const commandPolicySlice = createSlice({
  name: 'commandPolicies',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(fetchPolicies.pending, (state) => { state.loading = true })
    builder.addCase(fetchPolicies.fulfilled, (state, action) => {
      state.policies = action.payload
      state.loading = false
    })
    builder.addCase(createPolicy.fulfilled, (state, action) => {
      state.policies.push(action.payload)
    })
    builder.addCase(updatePolicy.fulfilled, (state, action) => {
      const idx = state.policies.findIndex(p => p.id === action.payload.id)
      if (idx >= 0) state.policies[idx] = action.payload
    })
    builder.addCase(deletePolicy.fulfilled, (state, action) => {
      state.policies = state.policies.filter(p => p.id !== action.payload)
    })
  },
})

export const commandPolicyReducer = commandPolicySlice.reducer
