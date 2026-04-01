import { Provider } from 'react-redux'
import { createRoot } from 'react-dom/client'
import { store } from './shared/state/store'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <App />
  </Provider>
)
