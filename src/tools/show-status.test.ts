import { describe, expect, it } from 'vitest'
import { a2ui } from '../a2ui/messages.ts'
import { captureContext, strictProcessor } from '../test/tool-harness.ts'
import { showStatusTool } from './show-status.ts'

describe('showStatus tool', () => {
  it('renders the accelerator, tensor ledger and active tasks', async () => {
    const { context, messages } = captureContext('showStatus-1', {
      accelerator: 'webnn-npu',
      tensors: { created: 12, deleted: 12 },
      activeTasks: 2,
    })
    await showStatusTool.run(context, { query: 'status' })
    const processor = strictProcessor()
    processor.processMessages([a2ui.createSurface('showStatus-1'), ...messages])
    const data = processor.getSurface('showStatus-1')!.dataModel
    expect(data.get('/accelerator')).toBe('Accelerator: WebNN (NPU)')
    expect(data.get('/tensors')).toBe('Tensors: 12 created · 12 deleted · 0 live')
    expect(data.get('/tasks')).toBe('Active tasks: 2')
  })

  it('reports when inference has not started', async () => {
    const { context, messages } = captureContext('showStatus-1', { accelerator: null })
    await showStatusTool.run(context, { query: '' })
    expect(JSON.stringify(messages)).toContain('Accelerator: not initialized')
  })

  it('completes when acknowledged', async () => {
    const { context } = captureContext('showStatus-1')
    const handle = await showStatusTool.run(context, { query: '' })
    expect(handle.onAction('acknowledge', {})).toBe('complete')
    expect(handle.onAction('other', {})).toBe('continue')
  })
})
