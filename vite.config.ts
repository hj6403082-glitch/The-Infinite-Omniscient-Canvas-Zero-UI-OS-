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
  // Long-lived vendor chunks cache across app deploys; the app chunk stays small.
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            { name: 'a2ui', test: /node_modules[\\/](@a2ui|lit|lit-html|lit-element|@lit|@lit-labs|@preact)[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  // Production-like headers: the header CSP also governs the intent worker.
  preview: { headers: { ...SECURITY_HEADERS } },
})
