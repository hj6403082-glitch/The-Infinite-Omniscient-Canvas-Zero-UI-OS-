import { LITERT_WASM_PATH, MODEL_URL } from '../config.ts'
import { createCanvasController } from './canvas-controller.ts'
import { createWorkerBridge, type WorkerBridge, type WorkerLike } from './worker-bridge.ts'

export { LITERT_WASM_PATH, MODEL_URL }

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
