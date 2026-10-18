import { describe, expect, it, vi } from 'vitest'
import { strictProcessor } from '../test/tool-harness.ts'
import { createMessageGate, MAX_MESSAGE_BYTES } from './message-gate.ts'
import { a2ui, jsonPointer } from './messages.ts'

function setup() {
  const processor = strictProcessor()
  const onReject = vi.fn()
  const gate = createMessageGate(processor, { onReject })
  return { processor, gate, onReject }
}

const text = (id: string, value: unknown) => ({ id, component: 'Text', text: value })

describe('A2UI message gate (CLAUDE.md §2)', () => {
  it('applies valid messages to the processor', () => {
    const { gate, processor, onReject } = setup()
    const applied = gate.apply([
      a2ui.createSurface('searchFiles-1'),
      a2ui.updateComponents('searchFiles-1', [text('root', { path: '/title' })]),
      a2ui.updateDataModel('searchFiles-1', jsonPointer('title'), 'Hello'),
    ])
    expect(applied).toBe(3)
    expect(onReject).not.toHaveBeenCalled()
    expect(processor.getSurface('searchFiles-1')?.dataModel.get('/title')).toBe('Hello')
  })

  it('drops messages that fail the official A2UI schema', () => {
    const { gate, onReject } = setup()
    expect(gate.apply([{ version: 'v0.9', executeScript: { code: 'alert(1)' } }, 'nope', null])).toBe(0)
    expect(onReject).toHaveBeenCalledTimes(3)
    expect(onReject.mock.calls[0][0]).toMatch(/schema/)
  })

  it('drops messages for surface ids the worker could not have issued', () => {
    const { gate, onReject } = setup()
    expect(gate.apply([a2ui.createSurface('../../admin')])).toBe(0)
    expect(onReject.mock.calls[0][0]).toMatch(/surface id/)
  })

  it('drops component definitions carrying markup or script URLs', () => {
    const { gate, onReject } = setup()
    gate.apply([a2ui.createSurface('searchFiles-1')])
    for (const bad of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'javascript:alert(1)',
      ' JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<b>x</b>',
      '<iframe src=//evil>',
      '<svg onload=alert(1)>',
    ]) {
      expect(gate.apply([a2ui.updateComponents('searchFiles-1', [text('root', bad)])]), bad).toBe(0)
    }
    expect(onReject).toHaveBeenCalledTimes(8)
  })

  it('drops data model values carrying script URLs or executable markup', () => {
    const { gate } = setup()
    gate.apply([a2ui.createSurface('searchFiles-1')])
    expect(gate.apply([a2ui.updateDataModel('searchFiles-1', '/a', { deep: ['javascript:alert(1)'] })])).toBe(0)
    expect(gate.apply([a2ui.updateDataModel('searchFiles-1', '/a', '<script>x</script>')])).toBe(0)
    // Ordinary text with angle brackets or "on" words is fine: it is rendered as text.
    expect(gate.apply([a2ui.updateDataModel('searchFiles-1', '/a', 'a < b, turn on lights')])).toBe(1)
  })

  it('enforces the URL policy on Image components (E3)', () => {
    const { gate } = setup()
    gate.apply([a2ui.createSurface('searchFiles-1')])
    const image = (url: unknown) => a2ui.updateComponents('searchFiles-1', [{ id: 'root', component: 'Image', url }])
    expect(gate.apply([image('/icons/pdf.svg')])).toBe(1)
    expect(gate.apply([image('https://tracker.example/pixel.gif')])).toBe(0)
    expect(gate.apply([image('//evil.example/x.png')])).toBe(0)
    expect(gate.apply([image({ path: '/img' })])).toBe(0) // URLs must be literal, never data-bound
  })

  it('drops oversized messages', () => {
    const { gate, onReject } = setup()
    gate.apply([a2ui.createSurface('searchFiles-1')])
    const huge = a2ui.updateDataModel('searchFiles-1', '/blob', 'x'.repeat(MAX_MESSAGE_BYTES))
    expect(gate.apply([huge])).toBe(0)
    expect(onReject.mock.calls[0][0]).toMatch(/too large/)
  })

  it('drops messages the strict processor rejects, without affecting later messages', () => {
    const { gate, processor, onReject } = setup()
    const applied = gate.apply([
      a2ui.createSurface('searchFiles-1'),
      a2ui.updateComponents('searchFiles-1', [{ id: 'root', component: 'Script', code: 'run()' }]),
      a2ui.updateComponents('searchFiles-1', [text('root', 'ok')]),
    ])
    expect(applied).toBe(2)
    expect(onReject.mock.calls[0][0]).toMatch(/Unknown component type 'Script'/)
    expect(processor.getSurface('searchFiles-1')).toBeDefined()
  })

  it('drops messages for surfaces using any catalog other than the trusted one', () => {
    const { gate } = setup()
    const foreign = { version: 'v0.9', createSurface: { surfaceId: 'searchFiles-1', catalogId: 'https://evil.example/catalog.json' } }
    expect(gate.apply([foreign])).toBe(0)
  })
})
