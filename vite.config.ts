import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { cspMetaPlugin } from './src/security/csp.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspMetaPlugin()],
})
