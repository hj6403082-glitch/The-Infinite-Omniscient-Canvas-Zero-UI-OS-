// Dedicated Web Worker entry: inference never runs on the main thread (CLAUDE.md §3).
import { liteRtPort } from '../inference/litert-adapter.ts'
import { createFileIndex, DEMO_FILES } from '../tools/file-index.ts'
import { createSearchFilesTool } from '../tools/search-files.ts'
import { showStatusTool } from '../tools/show-status.ts'
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
  tools: [createSearchFilesTool(createFileIndex(DEMO_FILES)), showStatusTool],
})

scope.addEventListener('message', (event) => {
  void runtime.handle(event.data)
})
