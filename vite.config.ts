import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { devClassicWorkerPlugin } from './src/build/dev-classic-worker-plugin.ts'
import { litertWasmPlugin } from './src/build/litert-wasm-plugin.ts'
import { cspMetaPlugin, SECURITY_HEADERS } from './src/security/csp.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    cspMetaPlugin(),
    litertWasmPlugin(),
    devClassicWorkerPlugin({ entry: 'src/worker/intent.worker.ts' }),
  ],
  // Classic (IIFE) worker: LiteRT.js loads its Wasm glue with importScripts().
  worker: { format: 'iife' },
  // React + lit + the A2UI runtime + zod form one ~650 kB (190 kB gzip) app chunk by design.
  build: { chunkSizeWarningLimit: 800 },
  // Production-like headers: the header CSP also governs the intent worker.
  preview: { headers: { ...SECURITY_HEADERS } },
})
