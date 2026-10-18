import { describe, expect, it, vi } from 'vitest'
import { createFakePort } from '../test/fake-litert.ts'
import { initInference } from './accelerator.ts'

const CONFIG = { wasmPath: '/litert-wasm/', modelUrl: '/models/intent.tflite' }
const quietLog = () => ({ info: vi.fn(), warn: vi.fn() })

describe('accelerator fallback chain (WebNN NPU -> WebGPU -> WASM)', () => {
  it('uses the NPU via WebNN when JSPI and WebNN are available', async () => {
    const { port } = createFakePort()
    const log = quietLog()
    const result = await initInference(port, { ...CONFIG, log })
    expect(port.loadRuntime).toHaveBeenCalledWith('/litert-wasm/', { jspi: true })
    expect(port.compile).toHaveBeenCalledTimes(1)
    expect(port.compile).toHaveBeenCalledWith('/models/intent.tflite', 'webnn-npu')
    expect(result.accelerator).toBe('webnn-npu')
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('webnn-npu'))
  })

  it('falls back to WebGPU when WebNN compilation fails', async () => {
    const { port } = createFakePort({ failCompile: { 'webnn-npu': new Error('no NPU') } })
    const log = quietLog()
    const result = await initInference(port, { ...CONFIG, log })
    expect(result.accelerator).toBe('webgpu')
    expect(result.attempts).toEqual([{ target: 'webnn-npu', reason: 'no NPU' }])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('no NPU'))
  })

  it('skips WebNN without compiling when JSPI is missing, and loads the non-JSPI runtime', async () => {
    const { port } = createFakePort({ features: { jspi: false } })
    const result = await initInference(port, { ...CONFIG, log: quietLog() })
    expect(port.loadRuntime).toHaveBeenCalledWith('/litert-wasm/', { jspi: false })
    expect(port.compile).not.toHaveBeenCalledWith(expect.anything(), 'webnn-npu')
    expect(result.accelerator).toBe('webgpu')
    expect(result.attempts[0]).toEqual({ target: 'webnn-npu', reason: 'unsupported: JSPI unavailable' })
  })

  it('skips WebNN when the browser lacks the WebNN API', async () => {
    const { port } = createFakePort({ features: { webnn: false } })
    const result = await initInference(port, { ...CONFIG, log: quietLog() })
    expect(result.attempts[0]).toEqual({ target: 'webnn-npu', reason: 'unsupported: WebNN unavailable' })
  })

  it('falls all the way back to WASM when neither WebNN nor WebGPU is usable', async () => {
    const { port } = createFakePort({ features: { webnn: false, webgpu: false } })
    const result = await initInference(port, { ...CONFIG, log: quietLog() })
    expect(result.accelerator).toBe('wasm')
    expect(result.attempts.map((a) => a.target)).toEqual(['webnn-npu', 'webgpu'])
  })

  it('throws with every reason when no accelerator can compile the model', async () => {
    const boom = new Error('bad model')
    const { port } = createFakePort({
      failCompile: { 'webnn-npu': boom, webgpu: boom, wasm: boom },
    })
    await expect(initInference(port, { ...CONFIG, log: quietLog() })).rejects.toThrow(
      /webnn-npu: bad model.*webgpu: bad model.*wasm: bad model/,
    )
  })

  it('propagates a runtime load failure without compiling anything', async () => {
    const { port } = createFakePort()
    port.loadRuntime.mockRejectedValueOnce(new Error('wasm 404'))
    await expect(initInference(port, { ...CONFIG, log: quietLog() })).rejects.toThrow('wasm 404')
    expect(port.compile).not.toHaveBeenCalled()
  })
})
