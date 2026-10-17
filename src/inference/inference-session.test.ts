import { describe, expect, it } from 'vitest'
import { createFakePort, FakeModel, FakeTensor } from '../test/fake-litert.ts'
import { InferenceSession } from './inference-session.ts'
import { TensorLedger } from './tensor-ledger.ts'
import type { InferenceTensor } from './types.ts'

function setup() {
  const { port, tensors } = createFakePort()
  const model = new FakeModel()
  const ledger = new TensorLedger()
  const session = new InferenceSession(port, model, ledger)
  return { port, tensors, model, ledger, session }
}

const input = () => new Float32Array([0.5, 1.5, 2.5])

describe('InferenceSession.run (CLAUDE.md §4: tensor.delete() every cycle)', () => {
  it('returns output values copied into JS memory', async () => {
    const { session } = setup()
    const [out] = await session.run(input(), [1, 3])
    expect(Array.from(out)).toEqual([0.5, 1.5, 2.5])
  })

  it('deletes the input and every output tensor; the ledger balances to 0', async () => {
    const { session, tensors, model, ledger } = setup()
    model.run.mockImplementationOnce(async () => {
      const outs = [new FakeTensor(new Float32Array([1])), new FakeTensor(new Float32Array([2]))]
      model.outputs.push(...outs)
      return outs
    })
    await session.run(input(), [1, 3])
    for (const t of [...tensors, ...model.outputs]) expect(t.delete).toHaveBeenCalledTimes(1)
    expect(ledger.stats).toEqual({ created: 3, deleted: 3 })
    ledger.assertBalanced()
  })

  it('deletes a tensor the model returns as both input and output only once', async () => {
    const { session, tensors, model, ledger } = setup()
    model.run.mockImplementationOnce(async (inputs: InferenceTensor[]) => inputs)
    await session.run(input(), [1, 3])
    expect(tensors[0].delete).toHaveBeenCalledTimes(1)
    ledger.assertBalanced()
  })

  it('stays balanced across 100 consecutive cycles', async () => {
    const { session, ledger } = setup()
    for (let i = 0; i < 100; i++) await session.run(input(), [1, 3])
    expect(ledger.stats).toEqual({ created: 200, deleted: 200 })
    ledger.assertBalanced()
  })
})

describe('InferenceSession.run error paths (B6)', () => {
  it('deletes the input tensor when model.run throws', async () => {
    const { session, tensors, model, ledger } = setup()
    model.run.mockRejectedValueOnce(new Error('NPU fault'))
    await expect(session.run(input(), [1, 3])).rejects.toThrow('NPU fault')
    expect(tensors[0].delete).toHaveBeenCalledTimes(1)
    ledger.assertBalanced()
  })

  it('deletes every output when reading one of them fails', async () => {
    const { session, tensors, model, ledger } = setup()
    const bad = new FakeTensor(new Float32Array([1]))
    const good = new FakeTensor(new Float32Array([2]))
    bad.data.mockRejectedValueOnce(new Error('readback failed'))
    model.run.mockResolvedValueOnce([bad, good])
    await expect(session.run(input(), [1, 3])).rejects.toThrow('readback failed')
    for (const t of [tensors[0], bad, good]) expect(t.delete).toHaveBeenCalledTimes(1)
    ledger.assertBalanced()
  })

  it('surfaces delete() failures together with the original error', async () => {
    const { session, tensors, model, port } = setup()
    port.createTensor.mockImplementationOnce((data, shape) => {
      const t = new FakeTensor(data, shape)
      t.delete.mockImplementation(() => {
        throw new Error('device lost')
      })
      tensors.push(t)
      return t
    })
    model.run.mockRejectedValueOnce(new Error('NPU fault'))
    const error = await session.run(input(), [1, 3]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual(['NPU fault', 'device lost'])
  })

  it('rejects overlapping cycles instead of queuing accelerator work', async () => {
    const { session, model, ledger } = setup()
    let finish!: () => void
    model.run.mockImplementationOnce(
      (inputs) => new Promise((resolve) => (finish = () => resolve(inputs))),
    )
    const first = session.run(input(), [1, 3])
    await expect(session.run(input(), [1, 3])).rejects.toThrow(/already in flight/)
    await Promise.resolve()
    finish()
    await first
    ledger.assertBalanced()
  })
})

describe('InferenceSession.dispose (B7)', () => {
  it('deletes the compiled model exactly once', () => {
    const { session, model } = setup()
    session.dispose()
    session.dispose()
    expect(model.delete).toHaveBeenCalledTimes(1)
    expect(session.disposed).toBe(true)
  })

  it('refuses to run after dispose', async () => {
    const { session, port } = setup()
    session.dispose()
    await expect(session.run(input(), [1, 3])).rejects.toThrow(/disposed/)
    expect(port.createTensor).not.toHaveBeenCalled()
  })

  it('defers model.delete() until an in-flight cycle has freed its tensors', async () => {
    const { session, model, ledger } = setup()
    let finish!: () => void
    model.run.mockImplementationOnce(
      (inputs) => new Promise((resolve) => (finish = () => resolve(inputs))),
    )
    const pending = session.run(input(), [1, 3])
    await Promise.resolve()
    session.dispose()
    expect(model.delete).not.toHaveBeenCalled()
    finish()
    await pending
    expect(model.delete).toHaveBeenCalledTimes(1)
    ledger.assertBalanced()
  })
})
