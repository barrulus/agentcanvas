import { configureStore } from '@reduxjs/toolkit'
import { agentsReducer } from './agentsSlice'
import { canvasReducer } from './canvasSlice'
import { mcpReducer } from './mcpSlice'
import { modesReducer } from './modesSlice'
import { templatesReducer } from './templatesSlice'

export const store = configureStore({
  reducer: {
    agents: agentsReducer,
    canvas: canvasReducer,
    mcp: mcpReducer,
    modes: modesReducer,
    templates: templatesReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
