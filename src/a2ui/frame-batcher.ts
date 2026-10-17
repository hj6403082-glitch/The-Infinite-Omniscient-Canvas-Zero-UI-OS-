export interface FrameScheduler {
  request(callback: () => void): number
  cancel(id: number): void
}

const animationFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
}

// Coalesces streamed items and applies them at most once per animation frame (CLAUDE.md §2).
export function createFrameBatcher<T>(apply: (items: T[]) => void, frames: FrameScheduler = animationFrames) {
  let queue: T[] = []
  let frame: number | null = null
  let disposed = false

  function run(): void {
    frame = null
    const items = queue
    queue = []
    if (items.length > 0) apply(items)
  }

  return {
    push(items: readonly T[]): void {
      if (disposed || items.length === 0) return
      queue.push(...items)
      frame ??= frames.request(run)
    },
    flush(): void {
      if (frame !== null) frames.cancel(frame)
      run()
    },
    dispose(): void {
      disposed = true
      if (frame !== null) frames.cancel(frame)
      frame = null
      queue = []
    },
  }
}
