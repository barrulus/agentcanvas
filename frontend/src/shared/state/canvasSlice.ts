import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export const loadLayout = createAsyncThunk('canvas/loadLayout', async () => {
  const res = await fetch('/api/layout')
  const data = await res.json()
  return data.cards as Record<string, CardPosition>
})

let saveTimer: ReturnType<typeof setTimeout> | null = null
export function debouncedSaveLayout(cards: Record<string, CardPosition>) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    fetch('/api/layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards }),
    })
  }, 500)
}

interface CardPosition {
  session_id: string
  x: number
  y: number
  width: number
  height: number
  zOrder: number
}

interface Connection {
  from: string
  to: string
}

interface CanvasState {
  cards: Record<string, CardPosition>
  connections: Connection[]
  nextZOrder: number
  selectedCards: string[]
}

const initialState: CanvasState = {
  cards: {},
  connections: [],
  nextZOrder: 1,
  selectedCards: [],
}

const GRID_GAP = 24
const DEFAULT_W = 480
const DEFAULT_H = 280
const ORIGIN_X = 40
const ORIGIN_Y = 16

function findOpenPosition(cards: Record<string, CardPosition>): { x: number; y: number } {
  const occupied = Object.values(cards)
  let x = ORIGIN_X
  let y = ORIGIN_Y
  const cols = 4

  for (let i = 0; i < 100; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx = ORIGIN_X + col * (DEFAULT_W + GRID_GAP)
    const cy = ORIGIN_Y + row * (DEFAULT_H + GRID_GAP)
    const overlaps = occupied.some(
      c => cx < c.x + c.width && cx + DEFAULT_W > c.x && cy < c.y + c.height && cy + DEFAULT_H > c.y
    )
    if (!overlaps) return { x: cx, y: cy }
  }
  return { x, y }
}

const canvasSlice = createSlice({
  name: 'canvas',
  initialState,
  reducers: {
    placeCard(state, action: PayloadAction<{ sessionId: string; x?: number; y?: number }>) {
      const pos = action.payload.x !== undefined
        ? { x: action.payload.x, y: action.payload.y! }
        : findOpenPosition(state.cards)
      state.cards[action.payload.sessionId] = {
        session_id: action.payload.sessionId,
        x: pos.x,
        y: pos.y,
        width: DEFAULT_W,
        height: DEFAULT_H,
        zOrder: state.nextZOrder++,
      }
    },
    moveCard(state, action: PayloadAction<{ sessionId: string; x: number; y: number }>) {
      const card = state.cards[action.payload.sessionId]
      if (card) {
        card.x = action.payload.x
        card.y = action.payload.y
      }
    },
    resizeCard(state, action: PayloadAction<{ sessionId: string; width: number; height: number; x?: number; y?: number }>) {
      const card = state.cards[action.payload.sessionId]
      if (card) {
        card.width = Math.max(320, action.payload.width)
        card.height = Math.max(180, action.payload.height)
        if (action.payload.x !== undefined) card.x = action.payload.x
        if (action.payload.y !== undefined) card.y = action.payload.y
      }
    },
    bringToFront(state, action: PayloadAction<string>) {
      const card = state.cards[action.payload]
      if (card) {
        card.zOrder = state.nextZOrder++
      }
    },
    removeCard(state, action: PayloadAction<string>) {
      delete state.cards[action.payload]
      state.connections = state.connections.filter(c => c.from !== action.payload && c.to !== action.payload)
      state.selectedCards = state.selectedCards.filter(id => id !== action.payload)
    },
    addConnection(state, action: PayloadAction<{ from: string; to: string }>) {
      const exists = state.connections.some(
        c => c.from === action.payload.from && c.to === action.payload.to
      )
      if (!exists) {
        state.connections.push(action.payload)
      }
    },
    setSelected(state, action: PayloadAction<string[]>) {
      state.selectedCards = action.payload
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadLayout.fulfilled, (state, action) => {
      state.cards = action.payload
      const maxZ = Object.values(action.payload).reduce((m, c) => Math.max(m, c.zOrder || 0), 0)
      state.nextZOrder = maxZ + 1
    })
  },
})

export const { placeCard, moveCard, resizeCard, bringToFront, removeCard, addConnection, setSelected } = canvasSlice.actions
export const canvasReducer = canvasSlice.reducer
