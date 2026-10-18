import { describe, expect, it, vi } from 'vitest'
import { LITERT_WASM_PATH, MODEL_URL, startCanvasRuntime } from './runtime.ts'
import type { WorkerLike } from './worker-bridge.ts'

function fakeWorker() {
  let listener: ((event: MessageEvent<unknown>) => void) | undefined
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn((_t: 'message', l: (event: MessageEvent<unknown>) => void) => {
      listener = l
    }),
    removeEventListener: vi.fn(),
  } satisfies WorkerLike
  return { worker, deliver: (data: unknown) => listener?.({ data } as MessageEvent<unknown>) }
}

describe('canvas runtime', () => {
  it('initializes inference with same-origin model and runtime paths', () => {
    const { worker } = fakeWorker()
    startCanvasRuntime(() => worker)
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'init', wasmPath: LITERT_WASM_PATH, modelUrl: MODEL_URL })
    expect(LITERT_WASM_PATH).toBe('/litert-wasm/')
    expect(MODEL_URL).toBe('/models/intent.tflite')
  })

  it('feeds validated worker events to the controller and reports malformed ones', () => {
    const { worker, deliver } = fakeWorker()
    const { controller } = startCanvasRuntime(() => worker)
    deliver({ type: 'ready', accelerator: 'webgpu', attempts: [] })
    deliver({ type: 'ready', accelerator: 'warp-drive', attempts: [] })
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', accelerator: 'webgpu' })
    expect(controller.getSnapshot().notices).toEqual(['Ignored a malformed message from the inference worker'])
  })

  it('routes controller commands to the worker and tears down on dispose', () => {
    const { worker } = fakeWorker()
    const runtime = startCanvasRuntime(() => worker)
    runtime.controller.text('find invoices')
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'text', text: 'find invoices' })
    runtime.dispose()
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'stop' })
    expect(worker.terminate).toHaveBeenCalled()
  })
})
