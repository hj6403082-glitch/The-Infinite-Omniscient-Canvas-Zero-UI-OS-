// Dedicated Web Worker entry: inference never runs on the main thread (CLAUDE.md §3).
import { liteRtPort } from '../inference/litert-adapter.ts'
import { createWorkerRuntime } from './worker-runtime.ts'

// Minimal typing for the dedicated worker scope (the app tsconfig uses the DOM lib).
const scope = self as unknown as {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

const runtime = createWorkerRuntime({
  port: liteRtPort,
  post: (event) => scope.postMessage(event),
  log: console,
})

scope.addEventListener('message', (event) => {
  void runtime.handle(event.data)
})
