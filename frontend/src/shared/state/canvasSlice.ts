import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export const fetchDashboards = createAsyncThunk('canvas/fetchDashboards', async () => {
  const res = await fetch('/api/dashboards')
  const data = await res.json()
  return data.dashboards
})

export const createDashboard = createAsyncThunk('canvas/createDashboard', async (name: string) => {
  const res = await fetch('/api/dashboards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return await res.json()
})

export const loadLayout = createAsyncThunk('canvas/loadLayout', async (dashboardId: string) => {
  const res = await fetch(`/api/dashboards/${dashboardId}/layout`)
  const data = await res.json()
  return {
    dashboardId,
    cards: data.cards as Record<string, CardPosition>,
    connections: (data.connections || []) as Connection[],
    groups: (data.groups || []) as Array<{ id: string; name: string; member_ids: string[]; collapsed: boolean; color?: string }>,
    constraints: (data.constraints || '') as string,
  }
})

let saveTimer: ReturnType<typeof setTimeout> | null = null
export function debouncedSaveLayout(
  dashboardId: string,
  cards: Record<string, CardPosition>,
  connections?: Connection[],
  groups?: Record<string, CardGroup>,
  constraints?: string,
) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const payload: Record<string, unknown> = { cards }
    if (connections) {
      payload.connections = connections.map(c => ({
        id: c.id,
        from_card_id: c.from,
        to_card_id: c.to,
        condition: c.condition,
        output_schema: c.output_schema,
        transform: c.transform,
        gate_rule: c.gate_rule,
      }))
    }
    if (groups) {
      payload.groups = Object.values(groups).map(g => ({
        id: g.id,
        name: g.name,
        member_ids: g.memberIds,
        collapsed: g.collapsed,
        color: g.color,
      }))
    }
    if (constraints !== undefined) {
      payload.constraints = constraints
    }
    fetch(`/api/dashboards/${dashboardId}/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
  card_type?: 'agent' | 'view' | 'input' | 'gate'
  collapsed?: boolean
}

interface Connection {
  id?: string
  from: string
  to: string
  condition?: string
  output_schema?: Record<string, any>
  transform?: string
  gate_rule?: string
}

interface CardGroup {
  id: string
  name: string
  memberIds: string[]
  collapsed: boolean
  color?: string
}

interface Dashboard {
  id: string
  name: string
  card_count: number
  created_at: number
}

interface CanvasState {
  cards: Record<string, CardPosition>
  connections: Connection[]
  groups: Record<string, CardGroup>
  constraints: string
  blockedConnections: Record<string, string>
  nextZOrder: number
  selectedCards: string[]
  currentDashboardId: string
  dashboards: Dashboard[]
}

const initialState: CanvasState = {
  cards: {},
  connections: [],
  groups: {},
  constraints: '',
  blockedConnections: {},
  nextZOrder: 1,
  selectedCards: [],
  currentDashboardId: 'default',
  dashboards: [],
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
    placeCard(state, action: PayloadAction<{ sessionId: string; x?: number; y?: number; card_type?: 'agent' | 'view' | 'input' | 'gate' }>) {
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
        card_type: action.payload.card_type || 'agent',
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
      // Remove from any groups
      for (const g of Object.values(state.groups)) {
        g.memberIds = g.memberIds.filter(id => id !== action.payload)
      }
    },
    toggleCardCollapsed(state, action: PayloadAction<string>) {
      const card = state.cards[action.payload]
      if (card) {
        card.collapsed = !card.collapsed
      }
    },
    addConnection(state, action: PayloadAction<{ from: string; to: string; condition?: string }>) {
      const exists = state.connections.some(
        c => c.from === action.payload.from && c.to === action.payload.to
      )
      if (!exists) {
        state.connections.push({
          id: crypto.randomUUID().replace(/-/g, ''),
          ...action.payload,
        })
      }
    },
    removeConnection(state, action: PayloadAction<string>) {
      state.connections = state.connections.filter(c => c.id !== action.payload)
    },
    updateConnectionCondition(state, action: PayloadAction<{ id: string; condition?: string }>) {
      const conn = state.connections.find(c => c.id === action.payload.id)
      if (conn) {
        conn.condition = action.payload.condition
      }
    },
    updateConnectionContract(state, action: PayloadAction<{ id: string; condition?: string; output_schema?: Record<string, any>; transform?: string; gate_rule?: string }>) {
      const conn = state.connections.find(c => c.id === action.payload.id)
      if (conn) {
        conn.condition = action.payload.condition
        conn.output_schema = action.payload.output_schema
        conn.transform = action.payload.transform
        conn.gate_rule = action.payload.gate_rule
      }
    },
    setConnections(state, action: PayloadAction<Connection[]>) {
      state.connections = action.payload
    },
    // --- Groups ---
    createGroup(state, action: PayloadAction<{ memberIds: string[]; name?: string }>) {
      const id = crypto.randomUUID().replace(/-/g, '')
      state.groups[id] = {
        id,
        name: action.payload.name || 'Group',
        memberIds: action.payload.memberIds,
        collapsed: false,
      }
      state.selectedCards = []
    },
    deleteGroup(state, action: PayloadAction<string>) {
      delete state.groups[action.payload]
    },
    renameGroup(state, action: PayloadAction<{ id: string; name: string }>) {
      const g = state.groups[action.payload.id]
      if (g) g.name = action.payload.name
    },
    toggleGroupCollapsed(state, action: PayloadAction<string>) {
      const g = state.groups[action.payload]
      if (g) g.collapsed = !g.collapsed
    },
    addToGroup(state, action: PayloadAction<{ groupId: string; cardId: string }>) {
      const g = state.groups[action.payload.groupId]
      if (g && !g.memberIds.includes(action.payload.cardId)) {
        g.memberIds.push(action.payload.cardId)
      }
    },
    removeFromGroup(state, action: PayloadAction<{ groupId: string; cardId: string }>) {
      const g = state.groups[action.payload.groupId]
      if (g) {
        g.memberIds = g.memberIds.filter(id => id !== action.payload.cardId)
      }
    },
    moveGroup(state, action: PayloadAction<{ groupId: string; dx: number; dy: number }>) {
      const g = state.groups[action.payload.groupId]
      if (g) {
        for (const memberId of g.memberIds) {
          const card = state.cards[memberId]
          if (card) {
            card.x += action.payload.dx
            card.y += action.payload.dy
          }
        }
      }
    },
    setConstraints(state, action: PayloadAction<string>) {
      state.constraints = action.payload
    },
    setConnectionBlocked(state, action: PayloadAction<{ connectionId: string; reason: string }>) {
      state.blockedConnections[action.payload.connectionId] = action.payload.reason
    },
    clearConnectionBlocked(state, action: PayloadAction<string>) {
      delete state.blockedConnections[action.payload]
    },
    setSelected(state, action: PayloadAction<string[]>) {
      state.selectedCards = action.payload
    },
    switchDashboard(state, action: PayloadAction<string>) {
      state.currentDashboardId = action.payload
      state.cards = {}
      state.connections = []
      state.groups = {}
      state.constraints = ''
      state.selectedCards = []
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadLayout.fulfilled, (state, action) => {
      state.cards = action.payload.cards
      state.constraints = action.payload.constraints
      const maxZ = Object.values(action.payload.cards).reduce((m, c) => Math.max(m, c.zOrder || 0), 0)
      state.nextZOrder = maxZ + 1
      // Load persisted connections
      if (action.payload.connections.length > 0) {
        state.connections = action.payload.connections.map(c => ({
          id: c.id || crypto.randomUUID().replace(/-/g, ''),
          from: (c as any).from_card_id || c.from,
          to: (c as any).to_card_id || c.to,
          condition: c.condition,
          output_schema: (c as any).output_schema,
          transform: (c as any).transform,
          gate_rule: (c as any).gate_rule,
        }))
      }
      // Load persisted groups
      state.groups = {}
      for (const g of action.payload.groups) {
        state.groups[g.id] = {
          id: g.id,
          name: g.name,
          memberIds: g.member_ids,
          collapsed: g.collapsed,
          color: g.color,
        }
      }
    })
    builder.addCase(fetchDashboards.fulfilled, (state, action) => {
      state.dashboards = action.payload
    })
    builder.addCase(createDashboard.fulfilled, (state, action) => {
      state.dashboards.push(action.payload)
    })
  },
})

export const { placeCard, moveCard, resizeCard, bringToFront, removeCard, toggleCardCollapsed, addConnection, removeConnection, updateConnectionCondition, updateConnectionContract, setConnections, setConstraints, setConnectionBlocked, clearConnectionBlocked, createGroup, deleteGroup, renameGroup, toggleGroupCollapsed, addToGroup, removeFromGroup, moveGroup, setSelected, switchDashboard } = canvasSlice.actions
export const canvasReducer = canvasSlice.reducer
