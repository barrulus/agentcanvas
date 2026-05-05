import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export interface CardRunRecord {
  card_id: string
  session_id: string | null
  card_type: 'agent' | 'gate' | 'dialogue' | 'merge' | 'view' | 'input'
  card_name: string
  status: 'running' | 'completed' | 'error' | 'stopped'
  started_at: number
  ended_at: number | null
  cost_usd: number
  tokens: number
  routes_taken: string[]
  error_text: string | null
}

export interface WorkflowRun {
  id: string
  dashboard_id: string
  trigger: 'input' | 'webhook' | 'manual'
  trigger_card_id: string
  trigger_card_name: string
  started_at: number
  ended_at: number | null
  status: 'running' | 'completed' | 'error' | 'interrupted' | 'stopped'
  card_runs: CardRunRecord[]
  total_cost_usd: number
  total_tokens: number
}

interface RunsState {
  byId: Record<string, WorkflowRun>
  orderByDashboard: Record<string, string[]>   // dashboard_id → [run_id...] newest first
  activeRunId: string | null                    // null = live canvas
}

const initialState: RunsState = { byId: {}, orderByDashboard: {}, activeRunId: null }

export const fetchRuns = createAsyncThunk(
  'runs/fetch',
  async ({ dashboardId, limit = 50, offset = 0 }: { dashboardId: string; limit?: number; offset?: number }) => {
    const res = await fetch(`/api/dashboards/${dashboardId}/runs?limit=${limit}&offset=${offset}`)
    const data = await res.json()
    return { dashboardId, runs: data.runs as WorkflowRun[], offset }
  },
)

export const fetchRun = createAsyncThunk('runs/fetchOne', async (runId: string) => {
  const res = await fetch(`/api/runs/${runId}`)
  return await res.json() as WorkflowRun
})

const runsSlice = createSlice({
  name: 'runs',
  initialState,
  reducers: {
    setRun(state, action: PayloadAction<WorkflowRun>) {
      const run = action.payload
      state.byId[run.id] = run
      const list = state.orderByDashboard[run.dashboard_id] || []
      if (!list.includes(run.id)) {
        state.orderByDashboard[run.dashboard_id] = [run.id, ...list]
      }
    },
    setActiveRun(state, action: PayloadAction<string | null>) {
      state.activeRunId = action.payload
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchRuns.fulfilled, (state, action) => {
      const { dashboardId, runs, offset } = action.payload
      for (const r of runs) state.byId[r.id] = r
      const ids = runs.map(r => r.id)
      const existing = state.orderByDashboard[dashboardId] || []
      state.orderByDashboard[dashboardId] = offset === 0
        ? ids
        : [...existing, ...ids.filter(id => !existing.includes(id))]
    })
    builder.addCase(fetchRun.fulfilled, (state, action) => {
      state.byId[action.payload.id] = action.payload
    })
  },
})

export const { setRun, setActiveRun } = runsSlice.actions
export const runsReducer = runsSlice.reducer
