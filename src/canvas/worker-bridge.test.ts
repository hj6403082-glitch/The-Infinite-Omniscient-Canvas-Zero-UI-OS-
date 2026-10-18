import { describe, expect, it, vi } from 'vitest'
import { createWorkerBridge, type WorkerLike } from './worker-bridge.ts'

function fakeWorker() {
  let listener: ((event: MessageEvent<unknown>) => void) | undefined
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn((_type: 'message', l: (event: MessageEvent<unknown>) => void) => {
      listener = l
    }),
    removeEventListener: vi.fn(() => {
      listener = undefined
    }),
  } satisfies WorkerLike
  const deliver = (data: unknown) => listener?.({ data } as MessageEvent<unknown>)
  return { worker, deliver }
}

describe('worker bridge (F1)', () => {
  it('forwards only events that pass the protocol schema', () => {
    const { worker, deliver } = fakeWorker()
    const onEvent = vi.fn()
    const onInvalid = vi.fn()
    createWorkerBridge(worker, { onEvent, onInvalid })
    deliver({ type: 'error', scope: 'tool', message: 'boom' })
    deliver({ type: 'ready', accelerator: 'quantum', attempts: [] })
    deliver('<script>')
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({ type: 'error', scope: 'tool', message: 'boom' })
    expect(onInvalid).toHaveBeenCalledTimes(2)
  })

  it('posts validated commands and refuses malformed ones', () => {
    const { worker } = fakeWorker()
    const bridge = createWorkerBridge(worker, { onEvent: vi.fn(), onInvalid: vi.fn() })
    bridge.send({ type: 'text', text: 'hello' })
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'text', text: 'hello' })
    expect(() => bridge.send({ type: 'dismiss', surfaceId: '../x' })).toThrow(/invalid worker command/)
  })

  it('dispose() asks the worker to stop, detaches and terminates it', () => {
    const { worker, deliver } = fakeWorker()
    const onEvent = vi.fn()
    const bridge = createWorkerBridge(worker, { onEvent, onInvalid: vi.fn() })
    bridge.dispose()
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'stop' })
    expect(worker.terminate).toHaveBeenCalled()
    deliver({ type: 'error', scope: 'tool', message: 'late' })
    expect(onEvent).not.toHaveBeenCalled()
  })
})
