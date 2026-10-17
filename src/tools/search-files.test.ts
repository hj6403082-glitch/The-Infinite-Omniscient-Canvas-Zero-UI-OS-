import { describe, expect, it } from 'vitest'
import { a2ui } from '../a2ui/messages.ts'
import { captureContext, strictProcessor } from '../test/tool-harness.ts'
import { createFileIndex, DEMO_FILES } from './file-index.ts'
import { createSearchFilesTool } from './search-files.ts'

const index = createFileIndex(DEMO_FILES, { latencyMs: 0 })

describe('file index (demo data)', () => {
  it('matches query tokens against names and kinds, ignoring filler words and plurals', async () => {
    const results = await index.search('find my invoices', new AbortController().signal)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((f) => /invoice/i.test(f.name))).toBe(true)
  })

  it('returns nothing for filler-only queries', async () => {
    expect(await index.search('show me the files', new AbortController().signal)).toEqual([])
  })

  it('caps the number of results', async () => {
    expect((await index.search('pdf png md txt xlsx', new AbortController().signal)).length).toBeLessThanOrEqual(25)
  })

  it('rejects when aborted', async () => {
    const slow = createFileIndex(DEMO_FILES, { latencyMs: 1000 })
    const controller = new AbortController()
    const pending = slow.search('invoice', controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
  })
})

describe('searchFiles tool', () => {
  it('streams a loading state, then binds results into the DataTable via JSON Pointer', async () => {
    const { context, messages } = captureContext('searchFiles-1')
    const tool = createSearchFilesTool(index)
    await tool.run(context, { query: 'invoices' })

    const processor = strictProcessor()
    processor.processMessages([a2ui.createSurface('searchFiles-1'), ...messages.slice(0, 2)])
    const surface = processor.getSurface('searchFiles-1')!
    expect(surface.dataModel.get('/loading')).toBe(true)
    expect(surface.dataModel.get('/results')).toEqual([])

    processor.processMessages(messages.slice(2))
    const results = surface.dataModel.get('/results') as { id: string; name: string }[]
    expect(surface.dataModel.get('/loading')).toBe(false)
    expect(results.length).toBeGreaterThan(0)
    expect(surface.dataModel.get('/status')).toMatch(/^\d+ files? match/)
  })

  it('puts the user query in the data model, never into component definitions', async () => {
    const { context, messages } = captureContext('searchFiles-1')
    await createSearchFilesTool(index).run(context, { query: '<img src=x onerror=alert(1)>' })
    const components = JSON.stringify(messages.filter((m) => 'updateComponents' in m))
    expect(components).not.toContain('onerror')
  })

  it('completes on openFile and stays open on other actions', async () => {
    const { context } = captureContext('searchFiles-1')
    const handle = await createSearchFilesTool(index).run(context, { query: 'invoice' })
    expect(handle.onAction('sort', {})).toBe('continue')
    expect(handle.onAction('openFile', { fileId: 'f1' })).toBe('complete')
  })

  it('stops emitting when aborted mid-search', async () => {
    const slow = createFileIndex(DEMO_FILES, { latencyMs: 1000 })
    const { context, messages, controller } = captureContext('searchFiles-1')
    const run = createSearchFilesTool(slow).run(context, { query: 'invoice' })
    const emittedBeforeAbort = messages.length
    controller.abort()
    await expect(run).rejects.toThrow(/abort/i)
    expect(messages).toHaveLength(emittedBeforeAbort)
  })
})
