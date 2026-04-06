import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export interface GateCard {
  id: string
  name: string
  mode: 'resolve' | 'synthesize'
  provider_id: string
  model: string
  status: 'idle' | 'waiting' | 'resolving' | 'completed' | 'error'
  pending_inputs: Record<string, string>
  resolved_output: string
  dashboard_id?: string
  created_at: number
}

interface GateCardsState {
  cards: Record<string, GateCard>
}

const initialState: GateCardsState = {
  cards: {},
}

export const fetchGateCards = createAsyncThunk('gateCards/fetch', async (dashboardId?: string) => {
  const url = dashboardId ? `/api/gate-cards?dashboard_id=${dashboardId}` : '/api/gate-cards'
  const res = await fetch(url)
  const data = await res.json()
  return data.gate_cards as GateCard[]
})

export const createGateCard = createAsyncThunk(
  'gateCards/create',
  async (params: { name?: string; mode?: string; provider_id: string; model: string; dashboard_id?: string }) => {
    const res = await fetch('/api/gate-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return await res.json() as GateCard
  }
)

const gateCardsSlice = createSlice({
  name: 'gateCards',
  initialState,
  reducers: {
    setGateCard(state, action: PayloadAction<GateCard>) {
      state.cards[action.payload.id] = action.payload
    },
    removeGateCard(state, action: PayloadAction<string>) {
      delete state.cards[action.payload]
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchGateCards.fulfilled, (state, action) => {
      for (const c of action.payload) {
        state.cards[c.id] = c
      }
    })
    builder.addCase(createGateCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
  },
})

export const { setGateCard, removeGateCard } = gateCardsSlice.actions
export const gateCardsReducer = gateCardsSlice.reducer
