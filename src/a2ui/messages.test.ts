import { A2uiMessageSchema, MessageProcessor, STRICT_VALIDATION } from '@a2ui/web_core/v0_9'
import { describe, expect, it } from 'vitest'
import { buildTrustedCatalog } from './catalog-spec.ts'
import { DataTableApi } from './data-table-api.ts'
import { a2ui, jsonPointer, TRUSTED_CATALOG_ID } from './messages.ts'

describe('jsonPointer (RFC 6901)', () => {
  it('builds the root and escapes "~" and "/" in segments', () => {
    expect(jsonPointer()).toBe('/')
    expect(jsonPointer('results')).toBe('/results')
    expect(jsonPointer('a/b', 'm~n', 3)).toBe('/a~1b/m~0n/3')
  })
})

describe('A2UI v0.9 message builders', () => {
  it('produce messages accepted by the official A2uiMessageSchema', () => {
    for (const message of [
      a2ui.createSurface('s1'),
      a2ui.updateComponents('s1', [{ id: 'root', component: 'Text', text: 'hi' }]),
      a2ui.updateDataModel('s1', jsonPointer('status'), 'Searching'),
      a2ui.deleteSurface('s1'),
    ]) {
      expect(A2uiMessageSchema.safeParse(message).success).toBe(true)
    }
  })

  it('always target the trusted catalog', () => {
    expect(a2ui.createSurface('s1')).toEqual({
      version: 'v0.9',
      createSurface: { surfaceId: 's1', catalogId: TRUSTED_CATALOG_ID },
    })
  })

  it('drive a full surface lifecycle through the real MessageProcessor under strict validation', () => {
    const processor = new MessageProcessor([buildTrustedCatalog([DataTableApi])], undefined, {
      validationConfig: STRICT_VALIDATION,
    })
    processor.processMessages([
      a2ui.createSurface('search-1'),
      a2ui.updateComponents('search-1', [
        { id: 'root', component: 'Column', children: ['status', 'table'] },
        { id: 'status', component: 'Text', text: { path: '/status' } },
        {
          id: 'table',
          component: 'DataTable',
          columns: [{ key: 'name', label: 'Name' }],
          rows: { path: '/results' },
          rowKey: 'id',
          selection: { path: '/selected' },
          action: { event: { name: 'openFile', context: { fileId: { path: '/selected' } } } },
        },
      ]),
      a2ui.updateDataModel('search-1', jsonPointer(), { status: 'Searching…', results: [] }),
    ])
    const surface = processor.getSurface('search-1')
    expect(surface?.dataModel.get('/status')).toBe('Searching…')

    processor.processMessages(a2ui.deleteSurface('search-1'))
    expect(processor.getSurface('search-1')).toBeUndefined()
  })
})

describe('trusted catalog spec', () => {
  const catalog = buildTrustedCatalog([DataTableApi])

  it('includes the basic layout/content/input components and DataTable', () => {
    for (const name of ['Column', 'Row', 'Text', 'Button', 'Card', 'Icon', 'Divider', 'DataTable']) {
      expect(catalog.components.has(name)).toBe(true)
    }
  })

  it('excludes media components and navigation functions', () => {
    expect(catalog.components.has('Video')).toBe(false)
    expect(catalog.components.has('AudioPlayer')).toBe(false)
    expect(catalog.functions.has('openUrl')).toBe(false)
    expect(catalog.functions.has('formatString')).toBe(true)
  })

  it('rejects DataTable columns or keys that are not plain identifiers', () => {
    const base = { columns: [{ key: 'name', label: 'Name' }], rows: { path: '/r' }, rowKey: 'id' }
    expect(DataTableApi.schema.safeParse(base).success).toBe(true)
    expect(DataTableApi.schema.safeParse({ ...base, rowKey: '__proto__' }).success).toBe(false)
    expect(DataTableApi.schema.safeParse({ ...base, columns: [{ key: 'a b', label: 'x' }] }).success).toBe(false)
    expect(DataTableApi.schema.safeParse({ ...base, onclick: 'alert(1)' }).success).toBe(false)
    expect(DataTableApi.schema.safeParse({ ...base, rows: [{ id: 1 }] }).success).toBe(false)
  })
})
