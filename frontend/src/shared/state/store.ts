import { configureStore } from '@reduxjs/toolkit'
import { agentsReducer } from './agentsSlice'
import { canvasReducer } from './canvasSlice'

export const store = configureStore({
  reducer: {
    agents: agentsReducer,
    canvas: canvasReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
