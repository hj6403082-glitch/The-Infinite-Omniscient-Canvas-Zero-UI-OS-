// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { DEV_WORKER_ROUTE, devClassicWorkerPlugin } from './dev-classic-worker-plugin.ts'

type Middleware = (req: unknown, res: { setHeader(n: string, v: string): void; end(body: string): void }, next: (e?: unknown) => void) => Promise<void>

function serve(entry = 'src/worker/intent.worker.ts') {
  let middleware: Middleware | undefined
  let onChange: (() => void) | undefined
  const server = {
    middlewares: { use: (route: string, fn: Middleware) => route === DEV_WORKER_ROUTE && (middleware = fn) },
    watcher: { on: (event: string, fn: () => void) => event === 'change' && (onChange = fn) },
  }
  const bundle = vi.fn(async () => `/* bundled ${entry} */ self.onmessage = () => {}`)
  devClassicWorkerPlugin({ entry, bundle }).configureServer(server as never)
  const request = async () => {
    const res = { headers: {} as Record<string, string>, body: '', setHeader(n: string, v: string) { this.headers[n] = v }, end(b: string) { this.body = b } }
    const next = vi.fn()
    await middleware!({}, res, next)
    return { res, next }
  }
  return { request, bundle, change: () => onChange?.() }
}

describe('dev classic worker plugin', () => {
  it('only applies to the dev server', () => {
    expect(devClassicWorkerPlugin({ entry: 'x.ts' }).apply).toBe('serve')
  })

  it('serves the worker as a classic script and caches the bundle', async () => {
    const { request, bundle } = serve()
    const first = await request()
    await request()
    expect(first.res.headers['content-type']).toBe('text/javascript')
    expect(first.res.body).toContain('bundled src/worker/intent.worker.ts')
    expect(bundle).toHaveBeenCalledTimes(1)
  })

  it('rebundles after a source change', async () => {
    const { request, bundle, change } = serve()
    await request()
    change()
    await request()
    expect(bundle).toHaveBeenCalledTimes(2)
  })

  it('reports bundling errors to the dev server and retries next time', async () => {
    const { request, bundle } = serve()
    bundle.mockRejectedValueOnce(new Error('syntax error'))
    const failed = await request()
    expect(failed.next).toHaveBeenCalledWith(expect.objectContaining({ message: 'syntax error' }))
    const ok = await request()
    expect(ok.res.body).toContain('bundled')
  })

  it('produces a real IIFE bundle with no ES module syntax', async () => {
    const { bundleClassicWorker } = await import('./dev-classic-worker-plugin.ts')
    const code = await bundleClassicWorker('src/worker/intent.worker.ts')
    expect(code).not.toMatch(/^\s*(import|export)\s/m)
    expect(code).toContain('Rejected invalid worker command')
    expect(code.length).toBeGreaterThan(10_000)
  }, 60_000)
})
