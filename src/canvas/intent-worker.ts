// Vite bundles the worker as a classic (IIFE) script: LiteRT.js loads its Wasm glue with
// importScripts(), which module workers do not support.
import builtWorkerUrl from '../worker/intent.worker.ts?worker&url'
import { createWorkerUrlPolicy } from './trusted-worker-url.ts'

// Must match DEV_WORKER_ROUTE in src/build/dev-classic-worker-plugin.ts.
const workerUrl = import.meta.env.DEV ? '/@canvas/intent-worker.js' : builtWorkerUrl

const toTrustedUrl = createWorkerUrlPolicy({
  base: location.href,
  trustedTypes: (globalThis as { trustedTypes?: Parameters<typeof createWorkerUrlPolicy>[0]['trustedTypes'] })
    .trustedTypes,
})

export function createIntentWorker(): Worker {
  // A TrustedScriptURL when Trusted Types are available; DOM typings predate them.
  return new Worker(toTrustedUrl(workerUrl) as string, { name: 'intent-worker' })
}
