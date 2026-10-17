import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakePort } from '../test/fake-litert.ts'
import { LOGITS } from '../test/fixtures/intent-logits.ts'
import type { WorkerEvent } from './protocol.ts'
import { createWorkerRuntime } from './worker-runtime.ts'

const INIT = { type: 'init', wasmPath: '/litert-wasm/', modelUrl: '/models/intent.tflite' } as const

function setup(options: Parameters<typeof createFakePort>[0] = {}) {
  const fake = createFakePort({ modelOutput: () => LOGITS.confidentSearch, ...options })
  const events: WorkerEvent[] = []
  const log = { info: vi.fn(), warn: vi.fn() }
  const runtime = createWorkerRuntime({ port: fake.port, post: (e) => events.push(e), log })
  return { ...fake, events, runtime }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('worker runtime (C5)', () => {
  it('initializes inference and reports the active accelerator', async () => {
    const { runtime, events } = setup({ features: { webnn: false } })
    await runtime.handle(INIT)
    expect(events).toEqual([
      { type: 'ready', accelerator: 'webgpu', attempts: [{ target: 'webnn-npu', reason: 'unsupported: WebNN unavailable' }] },
    ])
  })

  it('turns debounced command-bar text into an intent event', async () => {
    const { runtime, events } = setup()
    await runtime.handle(INIT)
    await runtime.handle({ type: 'pointer', x: 0.5, y: 0.5, at: 1 })
    await runtime.handle({ type: 'text', text: 'find invoices' })
    await vi.advanceTimersByTimeAsync(500)
    expect(events.at(-1)).toEqual({
      type: 'intent',
      intent: { tool: 'searchFiles', confidence: expect.any(Number) },
      query: 'find invoices',
    })
  })

  it('replays the latest text typed before the model was ready', async () => {
    const { runtime, events } = setup()
    await runtime.handle({ type: 'text', text: 'early' })
    await runtime.handle({ type: 'text', text: 'early bird' })
    await runtime.handle(INIT)
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'intent')).toEqual([expect.objectContaining({ query: 'early bird' })])
  })

  it('rejects invalid commands without echoing their payload', async () => {
    const { runtime, events } = setup()
    await runtime.handle({ type: 'eval', code: '<script>alert(1)</script>' })
    expect(events).toEqual([{ type: 'error', message: 'Rejected invalid worker command' }])
  })

  it('reports a failed init and allows a retry', async () => {
    const { runtime, events, port } = setup()
    port.loadRuntime.mockRejectedValueOnce(new Error('wasm 404'))
    await runtime.handle(INIT)
    expect(events).toEqual([{ type: 'error', message: 'Inference init failed: wasm 404' }])
    await runtime.handle(INIT)
    expect(events.at(-1)?.type).toBe('ready')
  })

  it('rejects a second init', async () => {
    const { runtime, events, port } = setup()
    await runtime.handle(INIT)
    await runtime.handle(INIT)
    expect(port.compile).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Inference already initialized' })
  })

  it('forwards inference errors as error events', async () => {
    const { runtime, events, models } = setup()
    await runtime.handle(INIT)
    models[0].run.mockRejectedValueOnce(new Error('NPU fault'))
    await runtime.handle({ type: 'text', text: 'x' })
    await vi.advanceTimersByTimeAsync(500)
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Inference failed: NPU fault' })
  })

  it('stop disposes the model and reports balanced tensor counts', async () => {
    const { runtime, events, models } = setup()
    await runtime.handle(INIT)
    for (const text of ['a', 'b', 'c']) {
      await runtime.handle({ type: 'text', text })
      await vi.advanceTimersByTimeAsync(500)
    }
    await runtime.handle({ type: 'stop' })
    expect(models[0].delete).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toEqual({ type: 'stopped', tensors: { created: 6, deleted: 6 } })
  })

  it('stop waits for an in-flight cycle so the reported counts balance', async () => {
    const { runtime, events, models } = setup()
    await runtime.handle(INIT)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const original = models[0].run.getMockImplementation()!
    models[0].run.mockImplementationOnce(async (inputs) => {
      await gate
      return original(inputs)
    })
    await runtime.handle({ type: 'text', text: 'slow' })
    await vi.advanceTimersByTimeAsync(500)
    const stopping = runtime.handle({ type: 'stop' })
    release()
    await stopping
    expect(events.at(-1)).toEqual({ type: 'stopped', tensors: { created: 2, deleted: 2 } })
    expect(events.some((e) => e.type === 'intent')).toBe(false)
  })

  it('stop during init disposes the model as soon as it compiles', async () => {
    const { runtime, events, models, port } = setup()
    let release!: () => void
    const gate = new Promise<undefined>((resolve) => (release = () => resolve(undefined)))
    port.loadRuntime.mockImplementationOnce(() => gate)
    const init = runtime.handle(INIT)
    const stop = runtime.handle({ type: 'stop' })
    release()
    await Promise.all([init, stop])
    expect(models[0].delete).toHaveBeenCalledTimes(1)
    expect(events.map((e) => e.type)).toEqual(['stopped'])
  })

  it('ignores everything after stop', async () => {
    const { runtime, events, port } = setup()
    await runtime.handle({ type: 'stop' })
    await runtime.handle(INIT)
    await runtime.handle({ type: 'text', text: 'late' })
    await vi.advanceTimersByTimeAsync(500)
    expect(port.loadRuntime).not.toHaveBeenCalled()
    expect(events).toEqual([{ type: 'stopped', tensors: { created: 0, deleted: 0 } }])
  })
})
