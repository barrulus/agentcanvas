import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export interface MergeCard {
  id: string
  name: string
  template: string
  timeout_seconds: number
  slots: Record<string, string>
  expected_slots: string[]
  status: 'idle' | 'waiting' | 'completed' | 'error'
  error_text?: string | null
  last_emitted_at?: number | null
  last_emitted_text?: string | null
  dashboard_id?: string
  created_at: number
}

interface MergeCardsState {
  cards: Record<string, MergeCard>
}

const initialState: MergeCardsState = {
  cards: {},
}

export const fetchMergeCards = createAsyncThunk('mergeCards/fetch', async (dashboardId?: string) => {
  const url = dashboardId ? `/api/merge-cards?dashboard_id=${dashboardId}` : '/api/merge-cards'
  const res = await fetch(url)
  const data = await res.json()
  return data.merge_cards as MergeCard[]
})

export const createMergeCard = createAsyncThunk(
  'mergeCards/create',
  async (params: { name?: string; template?: string; timeout_seconds?: number; dashboard_id?: string }) => {
    const res = await fetch('/api/merge-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return await res.json() as MergeCard
  },
)

export const updateMergeCard = createAsyncThunk(
  'mergeCards/update',
  async ({ id, updates }: { id: string; updates: Partial<Pick<MergeCard, 'name' | 'template' | 'timeout_seconds'>> }) => {
    const res = await fetch(`/api/merge-cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    return await res.json() as MergeCard
  },
)

export const resetMergeCard = createAsyncThunk('mergeCards/reset', async (id: string) => {
  await fetch(`/api/merge-cards/${id}/reset`, { method: 'POST' })
  return id
})

const mergeCardsSlice = createSlice({
  name: 'mergeCards',
  initialState,
  reducers: {
    setMergeCard(state, action: PayloadAction<MergeCard>) {
      state.cards[action.payload.id] = action.payload
    },
    removeMergeCard(state, action: PayloadAction<string>) {
      delete state.cards[action.payload]
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchMergeCards.fulfilled, (state, action) => {
      for (const c of action.payload) state.cards[c.id] = c
    })
    builder.addCase(createMergeCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
    builder.addCase(updateMergeCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
  },
})

export const { setMergeCard, removeMergeCard } = mergeCardsSlice.actions
export const mergeCardsReducer = mergeCardsSlice.reducer
