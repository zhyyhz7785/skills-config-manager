import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import P0Shell from './p0-shell'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <P0Shell />
  </StrictMode>,
)
