import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './app/App'
import { applyTheme, savedTheme } from './app/theme'

applyTheme(savedTheme()) // before the first render, so the saved mode shows straight away

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
