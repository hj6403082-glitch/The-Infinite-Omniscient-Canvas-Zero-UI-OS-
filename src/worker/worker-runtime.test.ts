import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakePort } from '../test/fake-litert.ts'
import { LOGITS } from '../test/fixtures/intent-logits.ts'
import { createFileIndex, DEMO_FILES } from '../tools/file-index.ts'
import { createSearchFilesTool } from '../tools/search-files.ts'
import { showStatusTool } from '../tools/show-status.ts'
import type { WorkerEvent } from './protocol.ts'
import { createWorkerRuntime } from './worker-runtime.ts'

const INIT = { type: 'init', wasmPath: '/litert-wasm/', modelUrl: '/models/intent.tflite' } as const

function setup(options: Parameters<typeof createFakePort>[0] = {}) {
  const fake = createFakePort({ modelOutput: () => LOGITS.confidentSearch, ...options })
  const events: WorkerEvent[] = []
  const log = { info: vi.fn(), warn: vi.fn() }
  const fileIndex = createFileIndex(DEMO_FILES, { latencyMs: 0 })
  const tools = [createSearchFilesTool(fileIndex), showStatusTool]
  const runtime = createWorkerRuntime({ port: fake.port, post: (e) => events.push(e), log, tools, fileIndex })
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
    expect(events.find((e) => e.type === 'intent')).toEqual({
      type: 'intent',
      intent: { tool: 'searchFiles', confidence: expect.any(Number) },
      query: 'find invoices',
      tensors: { created: 2, deleted: 2 },
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
    expect(events).toEqual([{ type: 'error', scope: 'protocol', message: 'Rejected invalid worker command' }])
  })

  it('reports a failed init and allows a retry', async () => {
    const { runtime, events, port } = setup()
    port.loadRuntime.mockRejectedValueOnce(new Error('wasm 404'))
    await runtime.handle(INIT)
    expect(events).toEqual([{ type: 'error', scope: 'init', message: 'Inference init failed: wasm 404' }])
    await runtime.handle(INIT)
    expect(events.at(-1)?.type).toBe('ready')
  })

  it('rejects a second init', async () => {
    const { runtime, events, port } = setup()
    await runtime.handle(INIT)
    await runtime.handle(INIT)
    expect(port.compile).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toEqual({ type: 'error', scope: 'protocol', message: 'Inference already initialized' })
  })

  it('forwards inference errors as error events', async () => {
    const { runtime, events, models } = setup()
    await runtime.handle(INIT)
    models[0].run.mockRejectedValueOnce(new Error('NPU fault'))
    await runtime.handle({ type: 'text', text: 'x' })
    await vi.advanceTimersByTimeAsync(500)
    expect(events.at(-1)).toEqual({ type: 'error', scope: 'inference', message: 'Inference failed: NPU fault' })
  })

  it('starts the predicted tool and streams its A2UI surface', async () => {
    const { runtime, events } = setup()
    await runtime.handle(INIT)
    await runtime.handle({ type: 'text', text: 'find invoices' })
    await vi.advanceTimersByTimeAsync(500)
    const a2uiMessages = events.flatMap((e) => (e.type === 'a2ui' ? e.messages : []))
    expect(a2uiMessages[0]).toEqual({
      version: 'v0.9',
      createSurface: { surfaceId: 'searchFiles-1', catalogId: expect.any(String) },
    })
    expect(JSON.stringify(a2uiMessages)).toContain('"/results"')
  })

  it('ends a dismissed task with deleteSurface and a balanced tensor ledger', async () => {
    const { runtime, events } = setup()
    await runtime.handle(INIT)
    await runtime.handle({ type: 'text', text: 'invoices' })
    await vi.advanceTimersByTimeAsync(500)
    await runtime.handle({ type: 'dismiss', surfaceId: 'searchFiles-1' })
    const deleteEvent = events.at(-2)
    expect(deleteEvent).toEqual({ type: 'a2ui', messages: [{ version: 'v0.9', deleteSurface: { surfaceId: 'searchFiles-1' } }] })
    expect(events.at(-1)).toEqual({
      type: 'taskEnded',
      surfaceId: 'searchFiles-1',
      tool: 'searchFiles',
      reason: 'dismissed',
      tensors: { created: 2, deleted: 2 },
    })
  })

  it('completes a task on its terminal action', async () => {
    const { runtime, events } = setup()
    await runtime.handle(INIT)
    await runtime.handle({ type: 'text', text: 'invoices' })
    await vi.advanceTimersByTimeAsync(500)
    await vi.runAllTimersAsync() // let the search tool finish streaming
    await runtime.handle({ type: 'action', surfaceId: 'searchFiles-1', name: 'openFile', context: { fileId: 'f1' } })
    expect(events.at(-1)).toMatchObject({ type: 'taskEnded', reason: 'completed' })
  })

  it('indexes a connected folder and searches it instead of the demo files', async () => {
    const { runtime, events } = setup()
    await runtime.handle({
      type: 'indexFiles',
      source: 'Docs',
      files: [{ id: 'u1', name: 'invoice-acme.pdf', path: 'Docs/invoice-acme.pdf', size: 10, modified: 0 }],
    })
    expect(events).toEqual([{ type: 'filesIndexed', source: 'Docs', count: 1 }])
    await runtime.handle(INIT)
    await runtime.handle({ type: 'text', text: 'find invoices' })
    await vi.runAllTimersAsync()
    const data = JSON.stringify(events.filter((e) => e.type === 'a2ui'))
    expect(data).toContain('invoice-acme.pdf')
    expect(data).not.toContain('invoice-2026-09.pdf')
  })

  it('asks the main thread to open the chosen file', async () => {
    const { runtime, events } = setup()
    await runtime.handle(INIT)
    await runtime.handle({ type: 'text', text: 'invoices' })
    await vi.runAllTimersAsync()
    await runtime.handle({ type: 'action', surfaceId: 'searchFiles-1', name: 'openFile', context: { fileId: 'f2' } })
    expect(events.slice(-3).map((e) => e.type)).toEqual(['openFile', 'a2ui', 'taskEnded'])
    expect(events.at(-3)).toEqual({ type: 'openFile', fileId: 'f2' })
  })

  it('ignores actions and dismissals before the model is ready', async () => {
    const { runtime, events } = setup()
    await runtime.handle({ type: 'dismiss', surfaceId: 'searchFiles-1' })
    await runtime.handle({ type: 'action', surfaceId: 'searchFiles-1', name: 'openFile', context: {} })
    expect(events).toEqual([])
  })

  it('stop deletes every open surface before reporting stopped', async () => {
    const { runtime, events } = setup({ modelOutput: () => LOGITS.confidentStatus })
    await runtime.handle(INIT)
    await runtime.handle({ type: 'text', text: 'status' })
    await vi.advanceTimersByTimeAsync(500)
    await runtime.handle({ type: 'stop' })
    expect(events.slice(-3)).toEqual([
      { type: 'a2ui', messages: [{ version: 'v0.9', deleteSurface: { surfaceId: 'showStatus-1' } }] },
      expect.objectContaining({ type: 'taskEnded', reason: 'shutdown' }),
      { type: 'stopped', tensors: { created: 2, deleted: 2 } },
    ])
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
