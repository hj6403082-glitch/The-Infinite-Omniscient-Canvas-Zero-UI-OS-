import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { litertWasmPlugin } from './src/build/litert-wasm-plugin.ts'
import { cspMetaPlugin } from './src/security/csp.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspMetaPlugin(), litertWasmPlugin()],
  // Classic (IIFE) worker: LiteRT.js loads its Wasm glue with importScripts().
  worker: { format: 'iife' },
})
