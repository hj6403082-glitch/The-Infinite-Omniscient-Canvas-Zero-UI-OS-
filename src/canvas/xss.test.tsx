import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { a2ui, jsonPointer } from '../a2ui/messages.ts'
import { queryDeep, textDeep } from '../test/shadow.ts'
import { Canvas } from './Canvas.tsx'
import { createCanvasController } from './canvas-controller.ts'

const syncFrames = { request: (cb: () => void) => (cb(), 0), cancel: () => undefined }
const SID = 'searchFiles-1'
const DANGEROUS = 'script, iframe, object, embed, img, svg, math, form, base, link, meta, style, video, audio'

const HOSTILE_COMPONENTS: unknown[] = [
  { id: 'root', component: 'Text', text: '<script>window.__xss = 1</script>' },
  { id: 'root', component: 'Text', text: '<img src=x onerror="window.__xss=1">' },
  { id: 'root', component: 'Image', url: 'javascript:window.__xss=1' },
  { id: 'root', component: 'Image', url: 'https://evil.example/pixel.gif' },
  { id: 'root', component: 'Video', url: '/movie.mp4' },
  { id: 'root', component: 'Html', html: '<b>x</b>' },
  { id: 'root', component: 'Text', text: 'hi', onclick: 'window.__xss=1' },
  { id: 'root', component: 'Text', text: 'hi', style: 'background:url(javascript:alert(1))' },
  { id: 'root', component: 'Button', child: 'l', action: { functionCall: { call: 'openUrl', args: { url: 'javascript:1' } } } },
]

describe('XSS: hostile A2UI never becomes executable DOM (E7)', () => {
  it('blocks every hostile payload and renders nothing dangerous', () => {
    const controller = createCanvasController({ send: () => undefined, frames: syncFrames })
    const view = render(<Canvas controller={controller} />)
    act(() => controller.handleEvent({ type: 'a2ui', messages: [a2ui.createSurface(SID)] }))
    for (const component of HOSTILE_COMPONENTS) {
      act(() => controller.handleEvent({ type: 'a2ui', messages: [a2ui.updateComponents(SID, [component as never])] }))
    }
    act(() =>
      controller.handleEvent({
        type: 'a2ui',
        messages: [
          a2ui.updateDataModel(SID, jsonPointer('x'), 'javascript:window.__xss=1'),
          a2ui.updateDataModel(SID, jsonPointer('x'), '<iframe src="https://evil.example">'),
          { version: 'v0.9', createSurface: { surfaceId: 'evil-1', catalogId: 'https://evil.example/catalog.json' } },
          { version: 'v0.9', eval: 'window.__xss=1' },
        ] as never,
      }),
    )
    expect(controller.getSnapshot().rejected).toBe(HOSTILE_COMPONENTS.length + 4)
    expect(queryDeep(view.container, DANGEROUS)).toBeNull()
    expect((window as { __xss?: unknown }).__xss).toBeUndefined()
  })

  it('renders markup-looking user text inertly, as text', async () => {
    const controller = createCanvasController({ send: () => undefined, frames: syncFrames })
    const view = render(<Canvas controller={controller} />)
    act(() =>
      controller.handleEvent({
        type: 'a2ui',
        messages: [
          a2ui.createSurface(SID),
          a2ui.updateComponents(SID, [{ id: 'root', component: 'Text', text: { path: '/q' } }]),
          a2ui.updateDataModel(SID, jsonPointer('q'), 'files where size < 10 && name has <b>'),
        ],
      }),
    )
    await screen.findByRole('region', { name: 'File search' })
    await act(async () => undefined)
    expect(textDeep(view.container)).toContain('files where size < 10 && name has <b>')
    expect(queryDeep(view.container, 'b')).toBeNull()
  })
})
