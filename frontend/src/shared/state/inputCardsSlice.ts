import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export interface InputCard {
  id: string
  name: string
  source_type: 'chat' | 'webhook' | 'file'
  config: Record<string, any>
  dashboard_id?: string
  created_at: number
}

interface InputCardsState {
  cards: Record<string, InputCard>
}

const initialState: InputCardsState = {
  cards: {},
}

export const fetchInputCards = createAsyncThunk('inputCards/fetch', async (dashboardId?: string) => {
  const url = dashboardId ? `/api/input-cards?dashboard_id=${dashboardId}` : '/api/input-cards'
  const res = await fetch(url)
  const data = await res.json()
  return data.input_cards as InputCard[]
})

export const createInputCard = createAsyncThunk(
  'inputCards/create',
  async (params: { name?: string; source_type?: string; config?: Record<string, any>; dashboard_id?: string }) => {
    const res = await fetch('/api/input-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return await res.json() as InputCard
  }
)

export const updateInputCard = createAsyncThunk(
  'inputCards/update',
  async (params: { id: string; name?: string; source_type?: string; config?: Record<string, any> }) => {
    const { id, ...body } = params
    const res = await fetch(`/api/input-cards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json() as InputCard
  }
)

export const sendInputCard = createAsyncThunk(
  'inputCards/send',
  async (params: { id: string; content: string }) => {
    await fetch(`/api/input-cards/${params.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: params.content }),
    })
    return params
  }
)

const inputCardsSlice = createSlice({
  name: 'inputCards',
  initialState,
  reducers: {
    setInputCard(state, action: PayloadAction<InputCard>) {
      state.cards[action.payload.id] = action.payload
    },
    removeInputCard(state, action: PayloadAction<string>) {
      delete state.cards[action.payload]
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchInputCards.fulfilled, (state, action) => {
      for (const c of action.payload) {
        state.cards[c.id] = c
      }
    })
    builder.addCase(createInputCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
    builder.addCase(updateInputCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
  },
})

export const { setInputCard, removeInputCard } = inputCardsSlice.actions
export const inputCardsReducer = inputCardsSlice.reducer
