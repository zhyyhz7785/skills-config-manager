import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installTauriCcmBridge } from './tauri/ccmBridge'
import App from './App'
import P0Shell from './p0-shell'
import './styles.css'

const useP0Shell = import.meta.env.VITE_CCM_P0_SHELL === '1'

if (!useP0Shell) {
  installTauriCcmBridge()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {useP0Shell ? <P0Shell /> : <App />}
  </StrictMode>,
)
