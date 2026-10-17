// Stub-model preprocessing: a fixed-size feature vector from command-bar text and pointer
// activity. Replace together with the real quantized intent model.

export const FEATURE_SIZE = 256
// Chosen by scripts/generate-stub-model.py so the stub model's keyword buckets don't collide.
export const HASH_SEED = 13
const TEXT_BUCKETS = FEATURE_SIZE - 2
const POINTER_WINDOW_MS = 2000
const MOVES_FOR_FULL_ACTIVITY = 20
const IDLE_SECONDS_FOR_FULL_IDLE = 10

export interface PointerSnapshot {
  recentMoves: number
  idleSeconds: number
}

// FNV-1a: a stable, dependency-free string hash for the hashing trick.
function fnv1a(token: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

// Lowercase alphanumeric runs. scripts/generate-stub-model.py mirrors this exactly.
export const tokenize = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

// Bucket index of a token in the text part of the feature vector.
export const bucketOf = (token: string): number => fnv1a(`${HASH_SEED}:${token}`) % TEXT_BUCKETS

export function featurize(text: string, pointer: PointerSnapshot): Float32Array<ArrayBuffer> {
  const features = new Float32Array(FEATURE_SIZE)
  for (const token of tokenize(text)) {
    features[bucketOf(token)] += 1
  }
  const norm = Math.hypot(...features.subarray(0, TEXT_BUCKETS))
  if (norm > 0) for (let i = 0; i < TEXT_BUCKETS; i++) features[i] /= norm

  features[TEXT_BUCKETS] = clamp01(pointer.recentMoves / MOVES_FOR_FULL_ACTIVITY)
  features[TEXT_BUCKETS + 1] = clamp01(pointer.idleSeconds / IDLE_SECONDS_FOR_FULL_IDLE)
  return features
}

export class PointerTracker {
  #moves: number[] = []

  record(at: number): void {
    this.#moves.push(at)
    this.#prune(at)
  }

  snapshot(now: number): PointerSnapshot {
    this.#prune(now)
    const last = this.#moves.at(-1)
    return {
      recentMoves: this.#moves.length,
      idleSeconds: last === undefined ? Number.POSITIVE_INFINITY : (now - last) / 1000,
    }
  }

  get size(): number {
    return this.#moves.length
  }

  #prune(now: number): void {
    const cutoff = now - POINTER_WINDOW_MS
    const firstKept = this.#moves.findIndex((at) => at >= cutoff)
    this.#moves.splice(0, firstKept === -1 ? this.#moves.length : firstKept)
  }
}
