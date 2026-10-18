import { describe, expect, it } from 'vitest'
import { FakeTensor } from '../test/fake-litert.ts'
import { TensorLedger } from './tensor-ledger.ts'

const tensor = () => new FakeTensor(new Float32Array([0]))

describe('TensorLedger (CLAUDE.md §4)', () => {
  it('starts balanced', () => {
    const ledger = new TensorLedger()
    expect(ledger.outstanding).toBe(0)
    expect(() => ledger.assertBalanced()).not.toThrow()
  })

  it('counts tracked tensors as outstanding until released', () => {
    const ledger = new TensorLedger()
    const a = ledger.track(tensor())
    ledger.track(tensor())
    expect(ledger.outstanding).toBe(2)
    expect(() => ledger.assertBalanced()).toThrow(/2 tensor\(s\) not deleted/)
    ledger.release(a)
    expect(ledger.outstanding).toBe(1)
    expect(ledger.stats).toEqual({ created: 2, deleted: 1 })
  })

  it('release() calls tensor.delete() exactly once', () => {
    const ledger = new TensorLedger()
    const t = ledger.track(tensor())
    ledger.release(t)
    expect(t.delete).toHaveBeenCalledTimes(1)
  })

  it('tracking the same tensor twice counts it once', () => {
    const ledger = new TensorLedger()
    const t = tensor()
    ledger.track(t)
    ledger.track(t)
    expect(ledger.stats.created).toBe(1)
  })

  it('rejects releasing an untracked or already released tensor (double delete)', () => {
    const ledger = new TensorLedger()
    const t = ledger.track(tensor())
    ledger.release(t)
    expect(() => ledger.release(t)).toThrow(/untracked or already released/)
    expect(t.delete).toHaveBeenCalledTimes(1)
  })

  it('releaseAll() deletes every tensor even when some delete() calls throw', () => {
    const ledger = new TensorLedger()
    const [a, b, c] = [tensor(), tensor(), tensor()].map((t) => ledger.track(t))
    b.delete.mockImplementationOnce(() => {
      throw new Error('device lost')
    })
    const errors = ledger.releaseAll([a, b, c])
    expect(errors).toHaveLength(1)
    expect(a.delete).toHaveBeenCalledTimes(1)
    expect(c.delete).toHaveBeenCalledTimes(1)
    // A tensor whose delete() threw is no longer owned by us; it must not be retried.
    expect(ledger.outstanding).toBe(0)
  })
})
