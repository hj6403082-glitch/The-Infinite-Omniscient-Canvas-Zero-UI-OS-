import { describe, expect, it } from 'vitest'
import { a2ui } from '../a2ui/messages.ts'
import { captureContext, strictProcessor } from '../test/tool-harness.ts'
import { createFileIndex, DEMO_FILES, toFileEntry } from './file-index.ts'
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
    expect(context.openFile).toHaveBeenCalledWith('f1')
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

describe('file index: user folders', () => {
  it('maps file metadata to table rows', () => {
    expect(
      toFileEntry({ id: 'u1', name: 'Budget Plan.xlsx', path: 'Docs/finance/Budget Plan.xlsx', size: 2048, modified: Date.UTC(2026, 9, 1) }),
    ).toEqual({
      id: 'u1',
      name: 'Budget Plan.xlsx',
      kind: 'Spreadsheet',
      modified: '2026-10-01',
      size: '2.0 KB',
      path: 'Docs/finance/Budget Plan.xlsx',
    })
    expect(toFileEntry({ id: 'u2', name: 'README', path: 'x/README', size: 0, modified: 0 }).kind).toBe('File')
    expect(toFileEntry({ id: 'u3', name: 'a.weird', path: 'a.weird', size: 5 * 1024 * 1024, modified: 0 }).size).toBe('5.0 MB')
  })

  it('replaces the index and searches folder names too', async () => {
    const userIndex = createFileIndex(DEMO_FILES, { latencyMs: 0 })
    userIndex.replace([
      toFileEntry({ id: 'u1', name: 'plan.xlsx', path: 'Docs/finance/plan.xlsx', size: 10, modified: 0 }),
    ])
    const signal = new AbortController().signal
    expect(await userIndex.search('invoice', signal)).toEqual([])
    expect((await userIndex.search('finance', signal)).map((f) => f.id)).toEqual(['u1'])
    expect(userIndex.has('u1')).toBe(true)
    expect(userIndex.has('f1')).toBe(false)
    expect(userIndex.size).toBe(1)
  })
})

describe('searchFiles: opening a file (terminal action)', () => {
  it('asks the runtime to open a known file, then completes', async () => {
    const { context } = captureContext('searchFiles-1')
    const handle = await createSearchFilesTool(index).run(context, { query: 'invoice' })
    expect(handle.onAction('openFile', { fileId: 'f2' })).toBe('complete')
    expect(context.openFile).toHaveBeenCalledWith('f2')
  })

  it('ignores unknown or malformed file ids', async () => {
    const { context } = captureContext('searchFiles-1')
    const handle = await createSearchFilesTool(index).run(context, { query: 'invoice' })
    expect(handle.onAction('openFile', { fileId: 'nope' })).toBe('continue')
    expect(handle.onAction('openFile', { fileId: 7 })).toBe('continue')
    expect(handle.onAction('openFile', {})).toBe('continue')
    expect(context.openFile).not.toHaveBeenCalled()
  })
})
