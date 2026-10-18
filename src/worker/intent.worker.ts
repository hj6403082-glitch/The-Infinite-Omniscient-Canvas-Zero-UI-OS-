// Dedicated Web Worker entry: inference never runs on the main thread (CLAUDE.md §3).
import { LITERT_WASM_PATH } from '../config.ts'
import { liteRtPort } from '../inference/litert-adapter.ts'
import { createFileIndex, DEMO_FILES } from '../tools/file-index.ts'
import { createSearchFilesTool } from '../tools/search-files.ts'
import { showStatusTool } from '../tools/show-status.ts'
import { createWorkerRuntime } from './worker-runtime.ts'
import { installWorkerTrustedTypes } from './worker-trusted-types.ts'

// Must run before LiteRT.js calls importScripts() under a header-delivered CSP.
installWorkerTrustedTypes(self as unknown as Parameters<typeof installWorkerTrustedTypes>[0], LITERT_WASM_PATH)

// Minimal typing for the dedicated worker scope (the app tsconfig uses the DOM lib).
const scope = self as unknown as {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

const fileIndex = createFileIndex(DEMO_FILES)
const runtime = createWorkerRuntime({
  port: liteRtPort,
  post: (event) => scope.postMessage(event),
  log: console,
  tools: [createSearchFilesTool(fileIndex), showStatusTool],
  fileIndex,
})

scope.addEventListener('message', (event) => {
  void runtime.handle(event.data)
})
