import { describe, expect, it, vi } from 'vitest'
import { a2ui, jsonPointer } from '../a2ui/messages.ts'
import type { WorkerCommand } from '../worker/protocol.ts'
import { createCanvasController } from './canvas-controller.ts'

const syncFrames = { request: (cb: () => void) => (cb(), 0), cancel: () => undefined }

function setup() {
  const sent: WorkerCommand[] = []
  const controller = createCanvasController({ send: (c) => sent.push(c), frames: syncFrames, now: () => 1000 })
  const stream = (...messages: unknown[]) => controller.handleEvent({ type: 'a2ui', messages: messages as never })
  return { controller, sent, stream }
}

const textSurface = (id: string) => [
  a2ui.createSurface(id),
  a2ui.updateComponents(id, [{ id: 'root', component: 'Text', text: { path: '/t' } }]),
  a2ui.updateDataModel(id, jsonPointer('t'), 'hello'),
]

describe('canvas controller', () => {
  it('starts in a loading state', () => {
    const { controller } = setup()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'loading', accelerator: null, surfaces: [] })
  })

  it('records the active accelerator and fallback attempts', () => {
    const { controller } = setup()
    controller.handleEvent({
      type: 'ready',
      accelerator: 'wasm',
      attempts: [{ target: 'webnn-npu', reason: 'unsupported: WebNN unavailable' }],
    })
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      accelerator: 'wasm',
      fallbacks: ['webnn-npu: unsupported: WebNN unavailable'],
    })
  })

  it('hydrates surfaces from streamed A2UI and removes them on deleteSurface', () => {
    const { controller, stream } = setup()
    const listener = vi.fn()
    controller.subscribe(listener)
    stream(...textSurface('searchFiles-1'))
    expect(controller.getSnapshot().surfaces.map((s) => s.id)).toEqual(['searchFiles-1'])
    expect(listener).toHaveBeenCalled()
    stream(a2ui.deleteSurface('searchFiles-1'))
    expect(controller.getSnapshot().surfaces).toEqual([])
  })

  it('counts and reports messages rejected by the gate', () => {
    const { controller, stream } = setup()
    stream(a2ui.createSurface('searchFiles-1'))
    stream(a2ui.updateComponents('searchFiles-1', [{ id: 'root', component: 'Text', text: '<script>x</script>' }]))
    expect(controller.getSnapshot().rejected).toBe(1)
    expect(controller.getSnapshot().notices.at(-1)).toMatch(/Blocked an unsafe UI update/)
  })

  it('tracks the latest intent and tensor ledger', () => {
    const { controller } = setup()
    controller.handleEvent({
      type: 'intent',
      intent: { tool: 'searchFiles', confidence: 0.93 },
      query: 'invoices',
      tensors: { created: 2, deleted: 2 },
    })
    expect(controller.getSnapshot().tensors).toEqual({ created: 2, deleted: 2 })
    controller.handleEvent({
      type: 'taskEnded',
      surfaceId: 'searchFiles-1',
      tool: 'searchFiles',
      reason: 'dismissed',
      tensors: { created: 8, deleted: 8 },
    })
    expect(controller.getSnapshot()).toMatchObject({
      lastIntent: { tool: 'searchFiles', confidence: 0.93, query: 'invoices' },
      tensors: { created: 8, deleted: 8 },
    })
  })

  it('sends command-bar text and throttled pointer activity to the worker', () => {
    let now = 0
    const sent: WorkerCommand[] = []
    const controller = createCanvasController({ send: (c) => sent.push(c), frames: syncFrames, now: () => now })
    controller.text('find invoices')
    controller.pointer(0.5, 0.25)
    now = 10
    controller.pointer(0.6, 0.25)
    now = 60
    controller.pointer(0.7, 0.25)
    expect(sent).toEqual([
      { type: 'text', text: 'find invoices' },
      { type: 'pointer', x: 0.5, y: 0.25, at: 0 },
      { type: 'pointer', x: 0.7, y: 0.25, at: 60 },
    ])
  })

  it('clamps pointer coordinates and truncates over-long text', () => {
    const { controller, sent } = setup()
    controller.pointer(-1, 7)
    controller.text('x'.repeat(5000))
    expect(sent[0]).toEqual({ type: 'pointer', x: 0, y: 1, at: 1000 })
    expect(sent[1]).toEqual({ type: 'text', text: 'x'.repeat(2000) })
  })

  it('routes A2UI actions to the worker with only flat primitive context', async () => {
    const { controller, sent, stream } = setup()
    stream(
      a2ui.createSurface('showStatus-1'),
      a2ui.updateComponents('showStatus-1', [
        { id: 'root', component: 'Button', child: 'l', action: { event: { name: 'acknowledge', context: { n: 1 } } } },
        { id: 'l', component: 'Text', text: 'Done' },
      ]),
    )
    const surface = controller.getSnapshot().surfaces[0]
    await surface.dispatchAction({ event: { name: 'acknowledge', context: { n: 1 } } }, 'root')
    expect(sent.at(-1)).toEqual({ type: 'action', surfaceId: 'showStatus-1', name: 'acknowledge', context: { n: 1 } })
  })

  it('sends dismissals for open surfaces only', () => {
    const { controller, sent, stream } = setup()
    stream(...textSurface('searchFiles-1'))
    controller.dismiss('searchFiles-1')
    controller.dismiss('nope-9')
    expect(sent).toEqual([{ type: 'dismiss', surfaceId: 'searchFiles-1' }])
  })

  it('surfaces worker errors as notices and keeps only the latest few', () => {
    const { controller } = setup()
    for (let i = 0; i < 10; i++) controller.handleEvent({ type: 'error', scope: 'tool', message: `e${i}` })
    expect(controller.getSnapshot().notices).toEqual(['e5', 'e6', 'e7', 'e8', 'e9'])
  })

  it('marks the canvas failed when inference cannot start', () => {
    const { controller } = setup()
    controller.handleEvent({ type: 'error', scope: 'init', message: 'Inference init failed: wasm 404' })
    expect(controller.getSnapshot().phase).toBe('failed')
  })
})
