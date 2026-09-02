import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installCcmMock, isBrowserPreview } from './browser/ccmMock'
import './styles.css'

if (isBrowserPreview()) {
  installCcmMock()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
