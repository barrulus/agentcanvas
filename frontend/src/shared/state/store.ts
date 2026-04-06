import { configureStore } from '@reduxjs/toolkit'
import { agentsReducer } from './agentsSlice'
import { canvasReducer } from './canvasSlice'
import { mcpReducer } from './mcpSlice'
import { modesReducer } from './modesSlice'
import { templatesReducer } from './templatesSlice'
import { viewCardsReducer } from './viewCardsSlice'
import { commandPolicyReducer } from './commandPolicySlice'
import { inputCardsReducer } from './inputCardsSlice'
import { gateCardsReducer } from './gateCardsSlice'

export const store = configureStore({
  reducer: {
    agents: agentsReducer,
    canvas: canvasReducer,
    mcp: mcpReducer,
    modes: modesReducer,
    templates: templatesReducer,
    viewCards: viewCardsReducer,
    commandPolicies: commandPolicyReducer,
    inputCards: inputCardsReducer,
    gateCards: gateCardsReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
