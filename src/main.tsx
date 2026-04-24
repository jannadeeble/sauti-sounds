import { Buffer } from 'buffer'
;(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { initializePwaInstall } from './lib/pwaInstall'

initializePwaInstall()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
