import { FEATURE_SIZE, featurize, PointerTracker } from '../inference/featurize.ts'
import type { InferenceSession } from '../inference/inference-session.ts'
import { decodeIntent, type Intent } from '../inference/intent-decoder.ts'

export const INTENT_DEBOUNCE_MS = 500

export interface IntentLoopOptions {
  session: Pick<InferenceSession, 'run' | 'dispose'>
  onIntent(intent: Intent, query: string): void
  onError(error: unknown): void
  now?: () => number
  debounceMs?: number
  threshold?: number
}

// Background intent loop (CLAUDE.md §5.1): evaluates the command-bar text 500 ms after
// typing stops, with pointer activity as extra features. At most one cycle in flight.
export class IntentLoop {
  #options: IntentLoopOptions
  #now: () => number
  #pointer = new PointerTracker()
  #text = ''
  #lastEvaluated: string | null = null
  #timer: ReturnType<typeof setTimeout> | undefined
  #inFlight = false
  #rerun = false
  #stopped = false

  constructor(options: IntentLoopOptions) {
    this.#options = options
    this.#now = options.now ?? (() => performance.now())
  }

  text(text: string): void {
    if (this.#stopped) return
    this.#text = text
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => void this.#evaluate(), this.#options.debounceMs ?? INTENT_DEBOUNCE_MS)
  }

  // Pointer activity only shapes the features; it never triggers inference by itself.
  pointer(_x: number, _y: number, at: number): void {
    if (this.#stopped) return
    this.#pointer.record(at)
  }

  stop(): void {
    if (this.#stopped) return
    this.#stopped = true
    clearTimeout(this.#timer)
    // Deferred by the session until an in-flight cycle has deleted its tensors.
    this.#options.session.dispose()
  }

  async #evaluate(): Promise<void> {
    if (this.#stopped) return
    if (this.#inFlight) {
      this.#rerun = true
      return
    }
    const query = this.#text.trim()
    if (!query || query === this.#lastEvaluated) return
    this.#lastEvaluated = query
    this.#inFlight = true
    try {
      const features = featurize(query, this.#pointer.snapshot(this.#now()))
      const [logits] = await this.#options.session.run(features, [1, FEATURE_SIZE])
      // Drop results that arrive after stop() or after the text has moved on.
      if (this.#stopped || this.#text.trim() !== query) return
      const intent = decodeIntent(logits, { threshold: this.#options.threshold })
      if (intent) this.#options.onIntent(intent, query)
    } catch (error) {
      this.#lastEvaluated = null // allow the user to retry the same query
      if (!this.#stopped) this.#options.onError(error)
    } finally {
      this.#inFlight = false
      if (this.#rerun) {
        this.#rerun = false
        void this.#evaluate()
      }
    }
  }
}
