import { describe, expect, it } from 'vitest'
import { LOGITS } from '../test/fixtures/intent-logits.ts'
import { decodeIntent, INTENT_LABELS } from './intent-decoder.ts'

describe('decodeIntent', () => {
  it('declares the v1 label order', () => {
    expect(INTENT_LABELS).toEqual(['none', 'searchFiles', 'showStatus'])
  })

  it('maps confident logits to a tool with its softmax probability', () => {
    const intent = decodeIntent(LOGITS.confidentSearch)
    expect(intent?.tool).toBe('searchFiles')
    expect(intent?.confidence).toBeCloseTo(0.9591, 3)
    expect(decodeIntent(LOGITS.confidentStatus)?.tool).toBe('showStatus')
  })

  it('returns null when the model predicts no intent', () => {
    expect(decodeIntent(LOGITS.idle)).toBeNull()
  })

  it('returns null below the confidence threshold', () => {
    expect(decodeIntent(LOGITS.ambiguous)).toBeNull()
    expect(decodeIntent(LOGITS.ambiguous, { threshold: 0.4 })?.tool).toBe('searchFiles')
  })

  it('is numerically stable for large logits', () => {
    const intent = decodeIntent(LOGITS.huge)
    expect(intent?.tool).toBe('searchFiles')
    expect(Number.isFinite(intent?.confidence)).toBe(true)
  })

  it('rejects logits whose length does not match the labels', () => {
    expect(() => decodeIntent(new Float32Array([1, 2]))).toThrow(/expected 3 logits, got 2/)
  })

  it('rejects non-finite logits', () => {
    expect(() => decodeIntent(new Float32Array([0, Number.NaN, 1]))).toThrow(/non-finite/)
  })
})
