import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { devClassicWorkerPlugin } from './src/build/dev-classic-worker-plugin.ts'
import { litertWasmPlugin } from './src/build/litert-wasm-plugin.ts'
import { cspMetaPlugin } from './src/security/csp.ts'

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
})
