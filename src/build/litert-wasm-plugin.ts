// Serves the LiteRT.js Wasm runtime from our own origin (the CSP forbids CDNs).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export const LITERT_WASM_ROUTE = '/litert-wasm'
// Threaded builds need cross-origin isolation (COOP/COEP), which this app does not enable.
export const LITERT_WASM_FILES: readonly string[] = ['internal', 'jspi_internal', 'compat_internal'].flatMap((v) => [
  `litert_wasm_${v}.js`,
  `litert_wasm_${v}.wasm`,
])

const wasmDir = () => join(dirname(createRequire(import.meta.url).resolve('@litertjs/core/package.json')), 'wasm')

interface Response {
  setHeader(name: string, value: string): void
  end(body?: unknown): void
}
type Middleware = (req: { url?: string }, res: Response, next: () => void) => void

export function litertWasmPlugin() {
  return {
    name: 'canvas:litert-wasm',

    configureServer(server: { middlewares: { use(route: string, middleware: Middleware): void } }) {
      server.middlewares.use(LITERT_WASM_ROUTE, (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!LITERT_WASM_FILES.includes(name)) return next()
        res.setHeader('content-type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        res.end(readFileSync(join(wasmDir(), name)))
      })
    },

    generateBundle(this: { emitFile(asset: { type: 'asset'; fileName: string; source: Uint8Array }): void }) {
      for (const name of LITERT_WASM_FILES) {
        this.emitFile({ type: 'asset', fileName: `litert-wasm/${name}`, source: readFileSync(join(wasmDir(), name)) })
      }
    },
  }
}
