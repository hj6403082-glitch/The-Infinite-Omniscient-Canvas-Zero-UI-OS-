// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { LITERT_WASM_FILES, LITERT_WASM_ROUTE, litertWasmPlugin } from './litert-wasm-plugin.ts'

type Middleware = (req: { url?: string }, res: FakeResponse, next: () => void) => void
interface FakeResponse {
  statusCode: number
  headers: Record<string, string>
  setHeader(name: string, value: string): void
  end(body?: unknown): void
  body?: unknown
}

function response(): FakeResponse {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body) {
      this.body = body
    },
  }
}

function devMiddleware(): Middleware {
  let middleware: Middleware | undefined
  const server = { middlewares: { use: (route: string, fn: Middleware) => route === LITERT_WASM_ROUTE && (middleware = fn) } }
  litertWasmPlugin().configureServer(server as never)
  return middleware!
}

describe('LiteRT wasm plugin', () => {
  it('ships the non-threaded runtime variants only (no COOP/COEP isolation)', () => {
    expect(LITERT_WASM_FILES).toEqual(
      expect.arrayContaining(['litert_wasm_internal.js', 'litert_wasm_jspi_internal.wasm', 'litert_wasm_compat_internal.js']),
    )
    expect(LITERT_WASM_FILES.some((f) => f.includes('threaded'))).toBe(false)
  })

  it('emits each runtime file into the build under /litert-wasm/', () => {
    const emitFile = vi.fn()
    litertWasmPlugin().generateBundle.call({ emitFile } as never)
    expect(emitFile.mock.calls.map(([asset]) => asset.fileName).sort()).toEqual(
      LITERT_WASM_FILES.map((f) => `litert-wasm/${f}`).sort(),
    )
    expect(emitFile.mock.calls[0][0]).toMatchObject({ type: 'asset', source: expect.any(Uint8Array) })
  })

  it('serves allowlisted files in dev with the right content type', () => {
    const middleware = devMiddleware()
    const res = response()
    middleware({ url: '/litert_wasm_jspi_internal.wasm' }, res, vi.fn())
    expect(res.headers['content-type']).toBe('application/wasm')
    expect((res.body as Uint8Array).byteLength).toBeGreaterThan(1_000_000)
    const js = response()
    middleware({ url: '/litert_wasm_internal.js?v=1' }, js, vi.fn())
    expect(js.headers['content-type']).toBe('text/javascript')
  })

  it('passes anything else through, including traversal attempts', () => {
    const middleware = devMiddleware()
    for (const url of ['/../package.json', '/%2e%2e/package.json', '/litert_wasm_threaded_internal.js', '/']) {
      const next = vi.fn()
      const res = response()
      middleware({ url }, res, next)
      expect(next, url).toHaveBeenCalled()
      expect(res.body, url).toBeUndefined()
    }
  })
})
