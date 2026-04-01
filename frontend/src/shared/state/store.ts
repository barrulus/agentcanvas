import { configureStore } from '@reduxjs/toolkit'
import { agentsReducer } from './agentsSlice'
import { canvasReducer } from './canvasSlice'
import { mcpReducer } from './mcpSlice'

export const store = configureStore({
  reducer: {
    agents: agentsReducer,
    canvas: canvasReducer,
    mcp: mcpReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
