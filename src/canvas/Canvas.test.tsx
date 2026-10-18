import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { a2ui, jsonPointer } from '../a2ui/messages.ts'
import { textDeep } from '../test/shadow.ts'
import type { WorkerCommand, WorkerEvent } from '../worker/protocol.ts'
import { Canvas } from './Canvas.tsx'
import { createCanvasController } from './canvas-controller.ts'

const syncFrames = { request: (cb: () => void) => (cb(), 0), cancel: () => undefined }

function setup() {
  const sent: WorkerCommand[] = []
  const controller = createCanvasController({ send: (c) => sent.push(c), frames: syncFrames })
  const emit = (event: WorkerEvent) => act(() => controller.handleEvent(event))
  const view = render(<Canvas controller={controller} />)
  return { controller, sent, emit, view }
}

const statusSurface = (id: string) =>
  ({
    type: 'a2ui',
    messages: [
      a2ui.createSurface(id),
      a2ui.updateComponents(id, [{ id: 'root', component: 'Text', text: { path: '/line' } }]),
      a2ui.updateDataModel(id, jsonPointer('line'), 'Accelerator: WebNN (NPU)'),
    ],
  }) as WorkerEvent

describe('Canvas (E6)', () => {
  it('shows the model loading, then the active accelerator', () => {
    const { emit } = setup()
    expect(screen.getByRole('status', { name: 'Accelerator' })).toHaveTextContent('Loading on-device model')
    emit({ type: 'ready', accelerator: 'webnn-npu', attempts: [] })
    expect(screen.getByRole('status', { name: 'Accelerator' })).toHaveTextContent('WebNN · NPU')
  })

  it('explains a fallback accelerator', () => {
    const { emit } = setup()
    emit({ type: 'ready', accelerator: 'wasm', attempts: [{ target: 'webnn-npu', reason: 'unsupported: WebNN unavailable' }] })
    const badge = screen.getByRole('status', { name: 'Accelerator' })
    expect(badge).toHaveTextContent('WASM · CPU')
    expect(badge).toHaveAttribute('title', expect.stringContaining('webnn-npu: unsupported: WebNN unavailable'))
  })

  it('sends command-bar input to the worker', () => {
    const { sent } = setup()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Command bar' }), { target: { value: 'find invoices' } })
    expect(sent).toContainEqual({ type: 'text', text: 'find invoices' })
  })

  it('sends pointer activity as viewport fractions', () => {
    const { sent } = setup()
    fireEvent.pointerMove(window, { clientX: window.innerWidth / 2, clientY: 0 })
    expect(sent.find((c) => c.type === 'pointer')).toMatchObject({ x: 0.5, y: 0 })
  })

  it('hydrates streamed surfaces inside trusted chrome and removes them on deleteSurface', async () => {
    const { emit } = setup()
    expect(screen.getByText(/Start typing/)).toBeInTheDocument()
    emit(statusSurface('showStatus-1'))
    const frame = screen.getByRole('region', { name: 'System status' })
    await waitFor(() => expect(textDeep(frame)).toContain('Accelerator: WebNN (NPU)'))
    emit({ type: 'a2ui', messages: [a2ui.deleteSurface('showStatus-1')] })
    expect(screen.queryByRole('region', { name: 'System status' })).toBeNull()
  })

  it('dismisses a surface through its chrome button', () => {
    const { emit, sent } = setup()
    emit(statusSurface('showStatus-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss System status' }))
    expect(sent).toContainEqual({ type: 'dismiss', surfaceId: 'showStatus-1' })
  })

  it('shows the tensor ledger and latest intent', () => {
    const { emit } = setup()
    emit({
      type: 'intent',
      intent: { tool: 'searchFiles', confidence: 0.964 },
      query: 'invoices',
      tensors: { created: 2, deleted: 2 },
    })
    emit({ type: 'taskEnded', surfaceId: 'searchFiles-1', tool: 'searchFiles', reason: 'dismissed', tensors: { created: 6, deleted: 6 } })
    expect(screen.getByRole('status', { name: 'Tensor ledger' })).toHaveTextContent('6 created · 6 deleted · 0 live')
    expect(screen.getByRole('status', { name: 'Last intent' })).toHaveTextContent('File search · 96%')
  })

  it('announces notices and a failed model load', () => {
    const { emit } = setup()
    emit({ type: 'error', scope: 'init', message: 'Inference init failed: wasm 404' })
    expect(screen.getByRole('log')).toHaveTextContent('Inference init failed: wasm 404')
    expect(screen.getByRole('status', { name: 'Accelerator' })).toHaveTextContent('Inference unavailable')
  })

  it('connects a local folder through a directory picker', () => {
    const { emit, sent } = setup()
    expect(screen.getByRole('status', { name: 'Files' })).toHaveTextContent('Demo files')
    const picker = screen.getByLabelText('Connect folder')
    expect(picker).toHaveAttribute('webkitdirectory')
    const f = new File(['x'], 'plan.txt')
    Object.defineProperty(f, 'webkitRelativePath', { value: 'Docs/plan.txt' })
    fireEvent.change(picker, { target: { files: [f] } })
    expect(sent.find((c) => c.type === 'indexFiles')).toMatchObject({ source: 'Docs' })
    emit({ type: 'filesIndexed', source: 'Docs', count: 1 })
    expect(screen.getByRole('status', { name: 'Files' })).toHaveTextContent('Docs · 1 file')
  })
})
