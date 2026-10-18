import { TensorLedger } from './tensor-ledger.ts'
import type { InferenceModel, InferenceTensor, LiteRtPort, TensorData } from './types.ts'

const NO_ERROR = Symbol('no error')

// Owns one compiled model and runs memory-safe inference cycles on it.
// Every tensor a cycle creates or receives is deleted before the cycle settles (CLAUDE.md §4).
export class InferenceSession {
  readonly ledger: TensorLedger
  #port: LiteRtPort
  #model: InferenceModel
  #inFlight = false
  #disposed = false
  #modelDeleted = false

  constructor(port: LiteRtPort, model: InferenceModel, ledger = new TensorLedger()) {
    this.#port = port
    this.#model = model
    this.ledger = ledger
  }

  get disposed(): boolean {
    return this.#disposed
  }

  async run(data: TensorData, shape: number[]): Promise<Float32Array[]> {
    if (this.#disposed) throw new Error('InferenceSession: run() after the session was disposed')
    if (this.#inFlight) throw new Error('InferenceSession: an inference cycle is already in flight')
    this.#inFlight = true

    const owned: InferenceTensor[] = []
    let cycleError: unknown = NO_ERROR
    try {
      const input = this.ledger.track(this.#port.createTensor(data, shape))
      owned.push(input)
      const outputs = await this.#model.run([input])
      // Take ownership of every output before reading any, so a failed read cannot leak the rest.
      for (const output of outputs) if (!owned.includes(output)) owned.push(this.ledger.track(output))
      const results: Float32Array[] = []
      // Copy out of accelerator/Wasm memory: the views die with tensor.delete().
      for (const output of outputs) results.push(Float32Array.from(await output.data()))
      return results
    } catch (error) {
      cycleError = error
      throw error
    } finally {
      const deleteErrors = this.ledger.releaseAll(owned)
      this.#inFlight = false
      if (this.#disposed) this.#deleteModel()
      if (deleteErrors.length > 0) {
        const errors = cycleError === NO_ERROR ? deleteErrors : [cycleError, ...deleteErrors]
        // A failed delete() means accelerator memory may have leaked; never swallow it.
        // eslint-disable-next-line no-unsafe-finally
        throw new AggregateError(errors, 'InferenceSession: tensor.delete() failed')
      }
    }
  }

  // Deletes the compiled model; deferred until an in-flight cycle has freed its tensors.
  dispose(): void {
    this.#disposed = true
    if (!this.#inFlight) this.#deleteModel()
  }

  #deleteModel(): void {
    if (this.#modelDeleted) return
    this.#modelDeleted = true
    this.#model.delete()
  }
}
