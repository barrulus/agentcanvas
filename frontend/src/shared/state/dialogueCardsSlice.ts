import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export interface DialogueParticipant {
  name: string
  description: string
  role: 'orchestrator' | 'worker'
  provider_id: string
  model: string
  system_prompt: string
  context_mode: 'full' | 'last_n' | 'question_only'
  context_last_n: number
  max_context_tokens: number | null
}

export interface DialogueTurn {
  speaker: string
  content: string
  timestamp: number
  cost_usd: number
}

export interface DialogueCard {
  id: string
  name: string
  participants: DialogueParticipant[]
  max_turns: number
  termination_rule: string | null
  initial_prompt: string
  output_mode: 'last_message' | 'full_transcript'
  status: 'idle' | 'running' | 'completed' | 'error'
  transcript: DialogueTurn[]
  final_output: string
  current_speaker: string | null
  dashboard_id?: string
  created_at: number
}

interface DialogueCardsState {
  cards: Record<string, DialogueCard>
}

const initialState: DialogueCardsState = {
  cards: {},
}

export const fetchDialogueCards = createAsyncThunk('dialogueCards/fetch', async (dashboardId?: string) => {
  const url = dashboardId ? `/api/dialogue-cards?dashboard_id=${dashboardId}` : '/api/dialogue-cards'
  const res = await fetch(url)
  const data = await res.json()
  return data.dialogue_cards as DialogueCard[]
})

export const createDialogueCard = createAsyncThunk(
  'dialogueCards/create',
  async (params: {
    name?: string
    participants?: DialogueParticipant[]
    max_turns?: number
    termination_rule?: string | null
    initial_prompt?: string
    output_mode?: 'last_message' | 'full_transcript'
    dashboard_id?: string
  }) => {
    const res = await fetch('/api/dialogue-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return await res.json() as DialogueCard
  }
)

export const updateDialogueCard = createAsyncThunk(
  'dialogueCards/update',
  async ({ id, updates }: { id: string; updates: Partial<DialogueCard> }) => {
    const res = await fetch(`/api/dialogue-cards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    return await res.json() as DialogueCard
  }
)

export const startDialogueCard = createAsyncThunk(
  'dialogueCards/start',
  async (id: string) => {
    await fetch(`/api/dialogue-cards/${id}/start`, { method: 'POST' })
    return id
  }
)

export const resetDialogueCard = createAsyncThunk(
  'dialogueCards/reset',
  async (id: string) => {
    await fetch(`/api/dialogue-cards/${id}/reset`, { method: 'POST' })
    return id
  }
)

export const deleteDialogueCard = createAsyncThunk(
  'dialogueCards/delete',
  async (id: string) => {
    await fetch(`/api/dialogue-cards/${id}`, { method: 'DELETE' })
    return id
  }
)

const dialogueCardsSlice = createSlice({
  name: 'dialogueCards',
  initialState,
  reducers: {
    setDialogueCard(state, action: PayloadAction<DialogueCard>) {
      state.cards[action.payload.id] = action.payload
    },
    removeDialogueCard(state, action: PayloadAction<string>) {
      delete state.cards[action.payload]
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchDialogueCards.fulfilled, (state, action) => {
      for (const c of action.payload) {
        state.cards[c.id] = c
      }
    })
    builder.addCase(createDialogueCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
    builder.addCase(updateDialogueCard.fulfilled, (state, action) => {
      state.cards[action.payload.id] = action.payload
    })
    builder.addCase(deleteDialogueCard.fulfilled, (state, action) => {
      delete state.cards[action.payload]
    })
  },
})

export const { setDialogueCard, removeDialogueCard } = dialogueCardsSlice.actions
export const dialogueCardsReducer = dialogueCardsSlice.reducer
