import type { InferenceTensor } from './types.ts'

// Accounts for every accelerator tensor so tests (and dev builds) can prove that
// each inference cycle deletes exactly what it created. CLAUDE.md §4.
export class TensorLedger {
  #live = new Set<InferenceTensor>()
  #created = 0
  #deleted = 0

  track<T extends InferenceTensor>(tensor: T): T {
    if (!this.#live.has(tensor)) {
      this.#live.add(tensor)
      this.#created += 1
    }
    return tensor
  }

  release(tensor: InferenceTensor): void {
    if (!this.#live.delete(tensor)) throw new Error('TensorLedger: release of untracked or already released tensor')
    this.#deleted += 1
    tensor.delete()
  }

  // Releases every tensor, continuing past failures; returns the errors thrown by delete().
  releaseAll(tensors: Iterable<InferenceTensor>): unknown[] {
    const errors: unknown[] = []
    for (const tensor of tensors) {
      try {
        this.release(tensor)
      } catch (error) {
        errors.push(error)
      }
    }
    return errors
  }

  get outstanding(): number {
    return this.#live.size
  }

  get stats(): { created: number; deleted: number } {
    return { created: this.#created, deleted: this.#deleted }
  }

  assertBalanced(): void {
    if (this.#live.size > 0) throw new Error(`TensorLedger: ${this.#live.size} tensor(s) not deleted`)
  }
}
