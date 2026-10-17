import { injectBasicCatalogStyles } from '@a2ui/web_core/v0_9/basic_catalog'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { createIntentWorker } from './canvas/intent-worker.ts'
import { startCanvasRuntime } from './canvas/runtime.ts'
import './index.css'

// Constructable stylesheets (adoptedStyleSheets) are allowed by the CSP; inline <style> is not.
injectBasicCatalogStyles()

const runtime = startCanvasRuntime(createIntentWorker)
window.addEventListener('pagehide', () => runtime.dispose(), { once: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App controller={runtime.controller} />
  </StrictMode>,
)
