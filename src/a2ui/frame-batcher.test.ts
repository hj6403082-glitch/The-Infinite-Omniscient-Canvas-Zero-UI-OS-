import { describe, expect, it, vi } from 'vitest'
import { createFrameBatcher } from './frame-batcher.ts'

function fakeFrames() {
  const callbacks = new Map<number, () => void>()
  let next = 1
  return {
    request: vi.fn((cb: () => void) => {
      callbacks.set(next, cb)
      return next++
    }),
    cancel: vi.fn((id: number) => callbacks.delete(id)),
    tick() {
      const pending = [...callbacks.values()]
      callbacks.clear()
      for (const cb of pending) cb()
    },
  }
}

describe('frame batcher (60 FPS hydration)', () => {
  it('applies everything queued within a frame in one ordered call', () => {
    const frames = fakeFrames()
    const apply = vi.fn()
    const batcher = createFrameBatcher<number>(apply, frames)
    batcher.push([1, 2])
    batcher.push([3])
    expect(apply).not.toHaveBeenCalled()
    expect(frames.request).toHaveBeenCalledTimes(1)
    frames.tick()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith([1, 2, 3])
  })

  it('schedules a new frame for items pushed after a flush', () => {
    const frames = fakeFrames()
    const apply = vi.fn()
    const batcher = createFrameBatcher<number>(apply, frames)
    batcher.push([1])
    frames.tick()
    batcher.push([2])
    frames.tick()
    expect(apply.mock.calls).toEqual([[[1]], [[2]]])
  })

  it('ignores empty pushes', () => {
    const frames = fakeFrames()
    createFrameBatcher<number>(vi.fn(), frames).push([])
    expect(frames.request).not.toHaveBeenCalled()
  })

  it('flush() applies synchronously and cancels the pending frame', () => {
    const frames = fakeFrames()
    const apply = vi.fn()
    const batcher = createFrameBatcher<number>(apply, frames)
    batcher.push([1])
    batcher.flush()
    expect(apply).toHaveBeenCalledWith([1])
    expect(frames.cancel).toHaveBeenCalled()
    frames.tick()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('dispose() drops queued items and ignores later pushes', () => {
    const frames = fakeFrames()
    const apply = vi.fn()
    const batcher = createFrameBatcher<number>(apply, frames)
    batcher.push([1])
    batcher.dispose()
    batcher.push([2])
    frames.tick()
    expect(apply).not.toHaveBeenCalled()
  })

  it('keeps later frames working when apply throws', () => {
    const frames = fakeFrames()
    const apply = vi.fn().mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const batcher = createFrameBatcher<number>(apply, frames)
    batcher.push([1])
    expect(() => frames.tick()).toThrow('boom')
    batcher.push([2])
    frames.tick()
    expect(apply).toHaveBeenLastCalledWith([2])
  })

  it('keeps scheduling with a scheduler that runs callbacks synchronously', () => {
    const apply = vi.fn()
    const batcher = createFrameBatcher<number>(apply, { request: (cb) => (cb(), 7), cancel: vi.fn() })
    batcher.push([1])
    batcher.push([2])
    expect(apply.mock.calls).toEqual([[[1]], [[2]]])
  })
})
