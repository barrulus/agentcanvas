import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export interface ViewCard {
  id: string
  name: string
  content: string
  dashboard_id?: string
  created_at: number
}

interface ViewCardsState {
  cards: Record<string, ViewCard>
}

const initialState: ViewCardsState = {
  cards: {},
}

export const fetchViewCards = createAsyncThunk('viewCards/fetch', async (dashboardId?: string) => {
  const url = dashboardId ? `/api/view-cards?dashboard_id=${dashboardId}` : '/api/view-cards'
  const res = await fetch(url)
  const data = await res.json()
  return data.view_cards as ViewCard[]
})

export const createViewCard = createAsyncThunk(
  'viewCards/create',
  async (params: { name?: string; content?: string; dashboard_id?: string }) => {
    const res = await fetch('/api/view-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return await res.json() as ViewCard
  }
)

export const updateViewCard = createAsyncThunk(
  'viewCards/update',
  async (params: { id: string; name?: string; content?: string }) => {
    const { id, ...body } = params
    const res = await fetch(`/api/view-cards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json() as ViewCard
  }
)

const viewCardsSlice = createSlice({
  name: 'viewCards',
  initialState,
  reducers: {
    setViewCard(state, action: PayloadAction<ViewCard>) {
      state.cards[action.payload.id] = action.payload
    },
    removeViewCard(state, action: PayloadAction<string>) {
      delete state.cards[action.payload]
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchViewCards.fulfilled, (state, action) => {
      for (const c of action.payload) {
        state.cards[c.id] = c
      }
    })
    builder.addCase(createViewCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
    builder.addCase(updateViewCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
  },
})

export const { setViewCard, removeViewCard } = viewCardsSlice.actions
export const viewCardsReducer = viewCardsSlice.reducer
