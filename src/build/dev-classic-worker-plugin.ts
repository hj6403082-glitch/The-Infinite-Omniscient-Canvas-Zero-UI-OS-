// Vite's dev server only serves workers as ES modules, but LiteRT.js loads its Wasm glue with
// importScripts(), which module workers forbid. In dev, serve the worker pre-bundled as a
// classic IIFE script instead (production builds already emit it that way).
import { resolve } from 'node:path'

export const DEV_WORKER_ROUTE = '/@canvas/intent-worker.js'

export async function bundleClassicWorker(entry: string): Promise<string> {
  const { build } = await import('vite')
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    mode: 'development',
    build: {
      write: false,
      minify: false,
      sourcemap: 'inline',
      lib: { entry: resolve(entry), formats: ['iife'], name: 'IntentWorker', fileName: () => 'intent-worker.js' },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as { output: { type: string; code?: string }[] }[]
  const chunk = outputs.flatMap((o) => o.output).find((o) => o.type === 'chunk')
  if (!chunk?.code) throw new Error(`Failed to bundle ${entry} as a classic worker`)
  return chunk.code
}

interface DevServer {
  middlewares: {
    use(
      route: string,
      middleware: (
        req: unknown,
        res: { setHeader(name: string, value: string): void; end(body: string): void },
        next: (error?: unknown) => void,
      ) => Promise<void>,
    ): void
  }
  watcher: { on(event: 'change', listener: () => void): void }
}

export function devClassicWorkerPlugin({ entry, bundle = bundleClassicWorker }: { entry: string; bundle?: typeof bundleClassicWorker }) {
  let cached: Promise<string> | undefined
  return {
    name: 'canvas:dev-classic-worker',
    apply: 'serve' as const,
    configureServer(server: DevServer) {
      server.watcher.on('change', () => {
        cached = undefined
      })
      server.middlewares.use(DEV_WORKER_ROUTE, async (_req, res, next) => {
        try {
          cached ??= bundle(entry)
          const code = await cached
          res.setHeader('content-type', 'text/javascript')
          res.end(code)
        } catch (error) {
          cached = undefined
          next(error)
        }
      })
    },
  }
}
