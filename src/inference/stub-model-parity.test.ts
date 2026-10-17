import { describe, expect, it } from 'vitest'
import parity from '../test/fixtures/stub-model-parity.json'
import { bucketOf, FEATURE_SIZE, featurize, HASH_SEED } from './featurize.ts'

// scripts/generate-stub-model.py bakes keyword buckets into public/models/intent.tflite.
// If the TS featurizer drifts from the Python one, the model silently stops working.
describe('stub model parity with scripts/generate-stub-model.py', () => {
  it('uses the same feature size and hash seed', () => {
    expect(FEATURE_SIZE).toBe(parity.featureSize)
    expect(HASH_SEED).toBe(parity.hashSeed)
  })

  it('hashes every keyword to the same bucket', () => {
    for (const [word, bucket] of Object.entries(parity.buckets)) expect(bucketOf(word), word).toBe(bucket)
  })

  it('produces the same feature vectors', () => {
    for (const [text, expected] of Object.entries(parity.phrases)) {
      const actual = featurize(text, { recentMoves: 0, idleSeconds: 0 })
      expected.forEach((value, i) => expect(actual[i], `${text}[${i}]`).toBeCloseTo(value, 5))
    }
  })
})
