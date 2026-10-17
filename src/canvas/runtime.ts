import { createCanvasController } from './canvas-controller.ts'
import { createWorkerBridge, type WorkerBridge, type WorkerLike } from './worker-bridge.ts'

// Same-origin locations (CLAUDE.md §3: the runtime and model never come from a CDN).
export const LITERT_WASM_PATH = '/litert-wasm/'
export const MODEL_URL = '/models/intent.tflite'

export function startCanvasRuntime(createWorker: () => WorkerLike) {
  // Worker events arrive asynchronously, after both objects exist.
  const bridge: WorkerBridge = createWorkerBridge(createWorker(), {
    onEvent: (event) => controller.handleEvent(event),
    onInvalid: () => controller.reportInvalidWorkerMessage(),
  })
  const controller = createCanvasController({ send: (command) => bridge.send(command) })
  bridge.send({ type: 'init', wasmPath: LITERT_WASM_PATH, modelUrl: MODEL_URL })
  return {
    controller,
    dispose(): void {
      bridge.dispose()
      controller.dispose()
    },
  }
}

export type CanvasRuntime = ReturnType<typeof startCanvasRuntime>
