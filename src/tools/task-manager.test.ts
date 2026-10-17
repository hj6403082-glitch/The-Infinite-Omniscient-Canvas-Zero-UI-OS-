import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { a2ui } from '../a2ui/messages.ts'
import { strictProcessor } from '../test/tool-harness.ts'
import { createToolRegistry } from './registry.ts'
import { createTaskManager, type TaskEnded } from './task-manager.ts'
import type { A2uiMessage, ToolActionResult, ToolContext, ToolDefinition, ToolName } from './types.ts'

// A tool whose run() can be held open and whose action results are scripted.
function controllableTool(name: ToolName) {
  const runs: { context: ToolContext; release: () => void; fail: (e: Error) => void }[] = []
  const actionResult = vi.fn<(name: string) => ToolActionResult>(() => 'continue')
  const tool: ToolDefinition = {
    name,
    run: (context) =>
      new Promise((resolve, reject) => {
        context.emit(a2ui.updateComponents(context.surfaceId, [{ id: 'root', component: 'Text', text: 'hi' }]))
        runs.push({ context, release: () => resolve({ onAction: (n) => actionResult(n) }), fail: reject })
      }),
  }
  return { tool, runs, actionResult }
}

const surfaceOf = (m: A2uiMessage): string => Object.values(m).find((v) => typeof v === 'object')!.surfaceId

function setup({ timeoutMs = 10_000, maxSurfaces = 4 } = {}) {
  const search = controllableTool('searchFiles')
  const status = controllableTool('showStatus')
  const messages: A2uiMessage[] = []
  const ended: TaskEnded[] = []
  const onError = vi.fn()
  const manager = createTaskManager({
    registry: createToolRegistry([search.tool, status.tool]),
    emit: (batch) => messages.push(...batch),
    status: () => ({ accelerator: 'wasm', tensors: { created: 0, deleted: 0 } }),
    onEnded: (e) => ended.push(e),
    onError,
    timeoutMs,
    maxSurfaces,
  })
  // CLAUDE.md §5.4 invariant: create first, delete last, exactly once each, nothing after delete.
  const assertLifecycles = () => {
    const bySurface = new Map<string, string[]>()
    for (const m of messages) {
      const kind = Object.keys(m).find((k) => k !== 'version')!
      bySurface.set(surfaceOf(m), [...(bySurface.get(surfaceOf(m)) ?? []), kind])
    }
    for (const [id, kinds] of bySurface) {
      expect(kinds[0], id).toBe('createSurface')
      expect(kinds.filter((k) => k === 'createSurface'), id).toHaveLength(1)
      if (kinds.includes('deleteSurface')) {
        expect(kinds.at(-1), id).toBe('deleteSurface')
        expect(kinds.filter((k) => k === 'deleteSurface'), id).toHaveLength(1)
      }
    }
    const processor = strictProcessor()
    processor.processMessages(messages)
    return processor
  }
  return { manager, search, status, messages, ended, onError, assertLifecycles }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('task manager: Tool-Call Render lifecycle', () => {
  it('creates the surface before the tool streams into it', async () => {
    const { manager, messages, assertLifecycles } = setup()
    const id = manager.start('searchFiles', 'invoices')
    expect(id).toBe('searchFiles-1')
    expect(Object.keys(messages[0])).toContain('createSurface')
    expect(Object.keys(messages[1])).toContain('updateComponents')
    expect(assertLifecycles().getSurface(id)).toBeDefined()
  })

  it('passes the query and a status snapshot to the tool', async () => {
    const { manager, search } = setup()
    manager.start('searchFiles', 'invoices')
    expect(search.runs[0].context.status()).toEqual({
      accelerator: 'wasm',
      tensors: { created: 0, deleted: 0 },
      activeTasks: 1,
    })
  })

  it('deletes the surface when the user dismisses it', async () => {
    const { manager, ended, assertLifecycles } = setup()
    const id = manager.start('searchFiles', 'q')
    expect(manager.dismiss(id)).toBe(true)
    expect(ended).toEqual([{ surfaceId: id, tool: 'searchFiles', reason: 'dismissed' }])
    expect(manager.active).toEqual([])
    expect(assertLifecycles().getSurfaces().size).toBe(0)
  })

  it('deletes the surface on a terminal action and keeps it on others', async () => {
    const { manager, search, ended, assertLifecycles } = setup()
    const id = manager.start('searchFiles', 'q')
    search.runs[0].release()
    await vi.advanceTimersByTimeAsync(0)
    expect(manager.action(id, 'sort', {})).toBe(true)
    expect(ended).toEqual([])
    search.actionResult.mockReturnValueOnce('complete')
    manager.action(id, 'openFile', { fileId: 'f1' })
    expect(ended).toEqual([{ surfaceId: id, tool: 'searchFiles', reason: 'completed' }])
    expect(assertLifecycles().getSurfaces().size).toBe(0)
  })

  it('deletes the surface and reports when the tool fails', async () => {
    const { manager, search, ended, onError, assertLifecycles } = setup()
    const id = manager.start('searchFiles', 'q')
    search.runs[0].fail(new Error('index offline'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledWith(id, expect.objectContaining({ message: 'index offline' }))
    expect(ended.at(-1)?.reason).toBe('error')
    assertLifecycles()
  })

  it('deletes the surface when an action handler throws', async () => {
    const { manager, search, ended, assertLifecycles } = setup()
    const id = manager.start('searchFiles', 'q')
    search.runs[0].release()
    await vi.advanceTimersByTimeAsync(0)
    search.actionResult.mockImplementationOnce(() => {
      throw new Error('bad action')
    })
    manager.action(id, 'openFile', {})
    expect(ended.at(-1)?.reason).toBe('error')
    assertLifecycles()
  })

  it('aborts and deletes a tool that does not finish streaming in time', async () => {
    const { manager, search, ended, assertLifecycles } = setup({ timeoutMs: 1000 })
    manager.start('searchFiles', 'q')
    await vi.advanceTimersByTimeAsync(1000)
    expect(search.runs[0].context.signal.aborted).toBe(true)
    expect(ended.at(-1)?.reason).toBe('timeout')
    assertLifecycles()
  })

  it('does not time out a tool that is waiting on the user', async () => {
    const { manager, search, ended } = setup({ timeoutMs: 1000 })
    manager.start('searchFiles', 'q')
    search.runs[0].release()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ended).toEqual([])
  })

  it('drops anything a tool emits after its task ended', async () => {
    const { manager, search, messages, assertLifecycles } = setup()
    const id = manager.start('searchFiles', 'q')
    manager.dismiss(id)
    const count = messages.length
    search.runs[0].context.emit(a2ui.updateDataModel(id, '/late', true))
    search.runs[0].release()
    await vi.advanceTimersByTimeAsync(0)
    expect(messages).toHaveLength(count)
    assertLifecycles()
  })

  it('supersedes an open task of the same tool when a new intent arrives', async () => {
    const { manager, search, ended, assertLifecycles } = setup()
    const first = manager.start('searchFiles', 'invoice')
    const second = manager.start('searchFiles', 'invoices 2026')
    expect(search.runs[0].context.signal.aborted).toBe(true)
    expect(ended).toEqual([{ surfaceId: first, tool: 'searchFiles', reason: 'superseded' }])
    expect(manager.active).toEqual([second])
    assertLifecycles()
  })

  it('keeps tasks of different tools side by side', () => {
    const { manager } = setup()
    manager.start('searchFiles', 'q')
    manager.start('showStatus', 'status')
    expect(manager.active).toEqual(['searchFiles-1', 'showStatus-2'])
  })

  it('evicts the oldest surface beyond the limit', () => {
    const { manager, ended } = setup({ maxSurfaces: 1 })
    const first = manager.start('searchFiles', 'q')
    manager.start('showStatus', 'status')
    expect(ended).toEqual([{ surfaceId: first, tool: 'searchFiles', reason: 'evicted' }])
  })

  it('ends every task on shutdown', async () => {
    const { manager, ended, assertLifecycles } = setup()
    manager.start('searchFiles', 'q')
    manager.start('showStatus', 's')
    manager.endAll()
    expect(ended.map((e) => e.reason)).toEqual(['shutdown', 'shutdown'])
    expect(assertLifecycles().getSurfaces().size).toBe(0)
  })

  it('ignores actions and dismissals for unknown or finished surfaces', () => {
    const { manager, messages } = setup()
    const id = manager.start('searchFiles', 'q')
    manager.dismiss(id)
    const count = messages.length
    expect(manager.dismiss(id)).toBe(false)
    expect(manager.action(id, 'openFile', {})).toBe(false)
    expect(manager.action('nope', 'openFile', {})).toBe(false)
    expect(messages).toHaveLength(count)
  })

  it('ignores actions while the tool is still streaming, but allows dismissal', () => {
    const { manager, ended } = setup()
    const id = manager.start('searchFiles', 'q')
    expect(manager.action(id, 'openFile', {})).toBe(false)
    expect(manager.dismiss(id)).toBe(true)
    expect(ended.at(-1)?.reason).toBe('dismissed')
  })
})
