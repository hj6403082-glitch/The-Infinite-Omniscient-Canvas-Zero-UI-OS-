import { beforeEach, describe, expect, it, vi } from 'vitest'

const litert = vi.hoisted(() => {
  class Tensor {
    readonly input: unknown
    readonly shape: unknown
    constructor(input: unknown, shape: unknown) {
      this.input = input
      this.shape = shape
    }
    data = vi.fn(async () => new Float32Array([1]))
    delete = vi.fn()
  }
  return {
    Tensor,
    loadLiteRt: vi.fn(async () => ({})),
    loadAndCompile: vi.fn(async () => ({ run: vi.fn(async () => [new Tensor(null, null)]), delete: vi.fn() })),
    supportsFeature: vi.fn(async () => true),
    isWebGPUSupported: vi.fn(() => true),
  }
})

vi.mock('@litertjs/core', () => litert)

async function freshAdapter() {
  vi.resetModules()
  return import('./litert-adapter.ts')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LiteRT.js adapter (CLAUDE.md §3)', () => {
  it('compiles for the NPU through WebNN with exactly the mandated options', async () => {
    const { liteRtPort } = await freshAdapter()
    await liteRtPort.compile('/models/intent.tflite', 'webnn-npu')
    expect(litert.loadAndCompile).toHaveBeenCalledWith('/models/intent.tflite', {
      accelerator: 'webnn',
      webNNOptions: { devicePreference: 'npu' },
    })
  })

  it('compiles fallbacks with the webgpu and wasm accelerators', async () => {
    const { liteRtPort } = await freshAdapter()
    await liteRtPort.compile('/m.tflite', 'webgpu')
    await liteRtPort.compile('/m.tflite', 'wasm')
    expect(litert.loadAndCompile).toHaveBeenNthCalledWith(1, '/m.tflite', { accelerator: 'webgpu' })
    expect(litert.loadAndCompile).toHaveBeenNthCalledWith(2, '/m.tflite', { accelerator: 'wasm' })
  })

  it('loads the runtime once, forwarding the JSPI flag WebNN needs', async () => {
    const { liteRtPort } = await freshAdapter()
    await liteRtPort.loadRuntime('/litert-wasm/', { jspi: true })
    await liteRtPort.loadRuntime('/litert-wasm/', { jspi: true })
    expect(litert.loadLiteRt).toHaveBeenCalledTimes(1)
    expect(litert.loadLiteRt).toHaveBeenCalledWith('/litert-wasm/', { jspi: true })
  })

  it('points Emscripten at wasmPath for the .wasm binary (it defaults to the worker script dir)', async () => {
    const { liteRtPort } = await freshAdapter()
    let locate: ((file: string) => string) | undefined
    litert.loadLiteRt.mockImplementationOnce(async () => {
      locate = (globalThis as { Module?: { locateFile(file: string): string } }).Module?.locateFile
      return {}
    })
    await liteRtPort.loadRuntime('/litert-wasm/', { jspi: true })
    expect(locate?.('litert_wasm_jspi_internal.wasm')).toBe(`${location.origin}/litert-wasm/litert_wasm_jspi_internal.wasm`)
  })

  it('allows a retry after the runtime fails to load', async () => {
    const { liteRtPort } = await freshAdapter()
    litert.loadLiteRt.mockRejectedValueOnce(new Error('network'))
    await expect(liteRtPort.loadRuntime('/w/', { jspi: false })).rejects.toThrow('network')
    await liteRtPort.loadRuntime('/w/', { jspi: false })
    expect(litert.loadLiteRt).toHaveBeenCalledTimes(2)
  })

  it('reports feature support from LiteRT.js', async () => {
    const { liteRtPort } = await freshAdapter()
    litert.supportsFeature.mockResolvedValueOnce(false)
    litert.isWebGPUSupported.mockReturnValueOnce(false)
    expect(await liteRtPort.supports('jspi')).toBe(false)
    expect(litert.supportsFeature).toHaveBeenCalledWith('jspi')
    expect(await liteRtPort.supports('webgpu')).toBe(false)
  })

  it('creates LiteRT tensors from typed arrays', async () => {
    const { liteRtPort } = await freshAdapter()
    const data = new Float32Array([1, 2])
    const tensor = liteRtPort.createTensor(data, [1, 2])
    expect(tensor).toBeInstanceOf(litert.Tensor)
    expect(tensor).toMatchObject({ input: data, shape: [1, 2] })
  })

  it('refuses to run a compiled model on tensors it did not create', async () => {
    const { liteRtPort } = await freshAdapter()
    const model = await liteRtPort.compile('/m.tflite', 'wasm')
    const foreign = { data: async () => new Float32Array(), delete: () => undefined }
    await expect(model.run([foreign])).rejects.toThrow(/not a LiteRT tensor/)
  })
})
