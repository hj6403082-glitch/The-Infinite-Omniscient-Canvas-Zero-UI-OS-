import { describe, expect, it } from 'vitest'
import { FEATURE_SIZE, featurize, PointerTracker } from './featurize.ts'

const still = { recentMoves: 0, idleSeconds: 10 }

describe('featurize (stub-model preprocessing)', () => {
  it('produces a fixed-size Float32Array', () => {
    const f = featurize('find my invoices', still)
    expect(f).toBeInstanceOf(Float32Array)
    expect(f).toHaveLength(FEATURE_SIZE)
  })

  it('is deterministic and case-insensitive', () => {
    expect(Array.from(featurize('Find Invoices', still))).toEqual(Array.from(featurize('find invoices', still)))
  })

  it('L2-normalizes the text buckets', () => {
    const f = featurize('alpha beta gamma alpha', still)
    const norm = Math.hypot(...f.subarray(0, FEATURE_SIZE - 2))
    expect(norm).toBeCloseTo(1, 5)
  })

  it('leaves text buckets at zero for blank text', () => {
    expect(featurize('   ', still).subarray(0, FEATURE_SIZE - 2).every((v) => v === 0)).toBe(true)
  })

  it('encodes pointer activity and idle time in the last two slots, clamped to [0, 1]', () => {
    const f = featurize('', { recentMoves: 10, idleSeconds: 2.5 })
    expect(f[FEATURE_SIZE - 2]).toBeCloseTo(0.5)
    expect(f[FEATURE_SIZE - 1]).toBeCloseTo(0.25)
    const busy = featurize('', { recentMoves: 500, idleSeconds: 999 })
    expect(busy[FEATURE_SIZE - 2]).toBe(1)
    expect(busy[FEATURE_SIZE - 1]).toBe(1)
  })
})

describe('PointerTracker', () => {
  it('counts moves within the last 2 seconds and the time since the last one', () => {
    const tracker = new PointerTracker()
    for (const at of [0, 500, 2500, 3000]) tracker.record(at)
    expect(tracker.snapshot(4000)).toEqual({ recentMoves: 2, idleSeconds: 1 })
  })

  it('reports full idleness before any pointer activity', () => {
    expect(new PointerTracker().snapshot(1234)).toEqual({ recentMoves: 0, idleSeconds: Number.POSITIVE_INFINITY })
  })

  it('keeps memory bounded under a flood of events', () => {
    const tracker = new PointerTracker()
    for (let at = 0; at < 100_000; at += 1) tracker.record(at)
    expect(tracker.size).toBeLessThanOrEqual(2001)
  })
})
