import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_SIZE } from '../inference/featurize.ts'
import { InferenceSession } from '../inference/inference-session.ts'
import { createFakePort, FakeModel, FakeTensor } from '../test/fake-litert.ts'
import { LOGITS } from '../test/fixtures/intent-logits.ts'
import { IntentLoop } from './intent-loop.ts'

type Logits = Float32Array<ArrayBuffer>

function setup(logitsFor: (features: Float32Array) => Logits = () => LOGITS.confidentSearch) {
  const { port } = createFakePort()
  const model = new FakeModel()
  model.run.mockImplementation(async (inputs) => {
    const out = new FakeTensor(logitsFor(Float32Array.from(await inputs[0].data())))
    model.outputs.push(out)
    return [out]
  })
  const session = new InferenceSession(port, model)
  const onIntent = vi.fn()
  const onError = vi.fn()
  let clock = 0
  const loop = new IntentLoop({ session, onIntent, onError, now: () => clock })
  const setClock = (ms: number) => {
    clock = ms
  }
  return { port, model, session, loop, onIntent, onError, setClock }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('IntentLoop: 500 ms debounce after typing stops', () => {
  it('does not run inference until 500 ms after the last keystroke', async () => {
    const { loop, model, onIntent } = setup()
    loop.text('find invoices')
    await vi.advanceTimersByTimeAsync(499)
    expect(model.run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(model.run).toHaveBeenCalledTimes(1)
    expect(onIntent).toHaveBeenCalledWith({ tool: 'searchFiles', confidence: expect.any(Number) }, 'find invoices')
  })

  it('restarts the debounce on every keystroke and evaluates only the final text', async () => {
    const { loop, model, onIntent } = setup()
    loop.text('f')
    await vi.advanceTimersByTimeAsync(300)
    loop.text('find')
    await vi.advanceTimersByTimeAsync(300)
    loop.text('find invoices')
    await vi.advanceTimersByTimeAsync(500)
    expect(model.run).toHaveBeenCalledTimes(1)
    expect(onIntent).toHaveBeenCalledWith(expect.anything(), 'find invoices')
  })

  it('never runs inference for pointer activity alone', async () => {
    const { loop, model } = setup()
    loop.pointer(0.5, 0.5, 10)
    await vi.advanceTimersByTimeAsync(5000)
    expect(model.run).not.toHaveBeenCalled()
  })

  it('feeds pointer activity into the model input', async () => {
    let seen: Float32Array | undefined
    const { loop, setClock } = setup((features) => {
      seen = features
      return LOGITS.idle
    })
    for (let at = 0; at < 10; at++) loop.pointer(0.1, 0.1, at)
    setClock(10)
    loop.text('status')
    await vi.advanceTimersByTimeAsync(500)
    expect(seen).toHaveLength(FEATURE_SIZE)
    expect(seen?.[FEATURE_SIZE - 2]).toBeCloseTo(0.5)
  })

  it('skips blank text and does not re-run an unchanged query', async () => {
    const { loop, model } = setup()
    loop.text('   ')
    await vi.advanceTimersByTimeAsync(500)
    expect(model.run).not.toHaveBeenCalled()
    loop.text('invoices')
    await vi.advanceTimersByTimeAsync(500)
    loop.text(' invoices ')
    await vi.advanceTimersByTimeAsync(500)
    expect(model.run).toHaveBeenCalledTimes(1)
  })

  it('emits nothing when the model predicts no intent', async () => {
    const { loop, onIntent, model } = setup(() => LOGITS.idle)
    loop.text('hmm')
    await vi.advanceTimersByTimeAsync(500)
    expect(model.run).toHaveBeenCalledTimes(1)
    expect(onIntent).not.toHaveBeenCalled()
  })
})

describe('IntentLoop: no overlapping cycles', () => {
  it('waits for the in-flight cycle, then evaluates the newest text and drops the stale result', async () => {
    const { loop, model, onIntent } = setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    model.run.mockImplementationOnce(async (inputs) => {
      await gate
      return inputs
    })
    loop.text('first query')
    await vi.advanceTimersByTimeAsync(500)
    loop.text('second query')
    await vi.advanceTimersByTimeAsync(500)
    expect(model.run).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(model.run).toHaveBeenCalledTimes(2)
    expect(onIntent).toHaveBeenCalledTimes(1)
    expect(onIntent).toHaveBeenCalledWith(expect.anything(), 'second query')
  })

  it('reports inference errors and keeps running', async () => {
    const { loop, model, onError, onIntent } = setup()
    model.run.mockRejectedValueOnce(new Error('NPU fault'))
    loop.text('one')
    await vi.advanceTimersByTimeAsync(500)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'NPU fault' }))
    loop.text('two')
    await vi.advanceTimersByTimeAsync(500)
    expect(onIntent).toHaveBeenCalledWith(expect.anything(), 'two')
  })

  it('lets the same query be retried after a failed cycle', async () => {
    const { loop, model, onIntent } = setup()
    model.run.mockRejectedValueOnce(new Error('transient'))
    loop.text('retry me')
    await vi.advanceTimersByTimeAsync(500)
    loop.text('retry me')
    await vi.advanceTimersByTimeAsync(500)
    expect(model.run).toHaveBeenCalledTimes(2)
    expect(onIntent).toHaveBeenCalledWith(expect.anything(), 'retry me')
  })

  it('reports malformed model output as an error', async () => {
    const { loop, onError } = setup(() => new Float32Array([1, 2]))
    loop.text('x')
    await vi.advanceTimersByTimeAsync(500)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/expected 3 logits/) }))
  })
})

describe('IntentLoop: tensor accounting (C3)', () => {
  it('keeps the ledger balanced across 100 debounced cycles, including failures', async () => {
    const { loop, model, session } = setup()
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) model.run.mockRejectedValueOnce(new Error('transient'))
      loop.text(`query ${i}`)
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(model.run).toHaveBeenCalledTimes(100)
    expect(session.ledger.stats.created).toBe(session.ledger.stats.deleted)
    session.ledger.assertBalanced()
  })
})

describe('IntentLoop.stop (C4)', () => {
  it('cancels a pending debounce, disposes the model and ignores further signals', async () => {
    const { loop, model } = setup()
    loop.text('pending')
    loop.stop()
    await vi.advanceTimersByTimeAsync(1000)
    loop.text('after stop')
    await vi.advanceTimersByTimeAsync(1000)
    expect(model.run).not.toHaveBeenCalled()
    expect(model.delete).toHaveBeenCalledTimes(1)
  })

  it('drops the result of a cycle in flight at stop, and frees its tensors before the model', async () => {
    const { loop, model, onIntent, session } = setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    model.run.mockImplementationOnce(async () => {
      await gate
      const out = new FakeTensor(LOGITS.confidentSearch)
      model.outputs.push(out)
      return [out]
    })
    loop.text('in flight')
    await vi.advanceTimersByTimeAsync(500)
    loop.stop()
    expect(model.delete).not.toHaveBeenCalled()
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(onIntent).not.toHaveBeenCalled()
    expect(model.delete).toHaveBeenCalledTimes(1)
    session.ledger.assertBalanced()
  })

  it('is idempotent', () => {
    const { loop, model } = setup()
    loop.stop()
    loop.stop()
    expect(model.delete).toHaveBeenCalledTimes(1)
  })
})
