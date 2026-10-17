import { A2uiSurface, type ReactCatalogComponent } from '@a2ui/react/v0_9'
import { type ActionPayload, MessageProcessor, STRICT_VALIDATION, type SurfaceModel } from '@a2ui/web_core/v0_9'
import { getMarkdownRenderer } from '@a2ui/web_core/v0_9/basic_catalog'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { queryDeep, textDeep } from '../test/shadow.ts'
import { a2ui, jsonPointer } from './messages.ts'
import { trustedCatalog } from './trusted-catalog.ts'

const ROWS = [
  { id: 'f1', name: 'invoice-2026-08.pdf', kind: 'PDF document' },
  { id: 'f2', name: 'invoice-2026-09.pdf', kind: 'PDF document' },
]

const TABLE = {
  id: 'table',
  component: 'DataTable',
  caption: 'Matching files',
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'kind', label: 'Kind' },
  ],
  rows: { path: '/results' },
  rowKey: 'id',
  selection: { path: '/selected' },
  action: { event: { name: 'openFile', context: { fileId: { path: '/selected' } } } },
  emptyText: { path: '/emptyText' },
}

function renderSurface(components: Record<string, unknown>[], data: Record<string, unknown>) {
  const onAction = vi.fn<(action: ActionPayload) => void>()
  const processor = new MessageProcessor([trustedCatalog], onAction, { validationConfig: STRICT_VALIDATION })
  processor.processMessages([
    a2ui.createSurface('searchFiles-1'),
    a2ui.updateComponents('searchFiles-1', components as never),
    a2ui.updateDataModel('searchFiles-1', jsonPointer(), data),
  ])
  const surface = processor.getSurface('searchFiles-1') as SurfaceModel<ReactCatalogComponent>
  const view = render(<A2uiSurface surface={surface} />)
  return { processor, onAction, view }
}

describe('Trusted Catalog rendering', () => {
  it('renders DataTable rows bound through a JSON Pointer', () => {
    renderSurface([{ ...TABLE, id: 'root' }], { results: ROWS, emptyText: 'none' })
    const table = screen.getByRole('table', { name: 'Matching files' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Kind'])
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByText('invoice-2026-09.pdf')).toBeInTheDocument()
  })

  it('re-renders when the bound data changes', () => {
    const { processor } = renderSurface([{ ...TABLE, id: 'root' }], { results: [], emptyText: 'Searching…' })
    expect(screen.getByText('Searching…')).toBeInTheDocument()
    act(() => {
      processor.processMessages(a2ui.updateDataModel('searchFiles-1', jsonPointer('results'), ROWS))
    })
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('writes the selection and dispatches the action when a row is activated', async () => {
    const { processor, onAction } = renderSurface([{ ...TABLE, id: 'root' }], { results: ROWS, emptyText: '' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'invoice-2026-09.pdf' }))
    })
    expect(processor.getSurface('searchFiles-1')?.dataModel.get('/selected')).toBe('f2')
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'openFile', surfaceId: 'searchFiles-1', context: { fileId: 'f2' } }),
    )
  })

  it('renders cell values strictly as text and ignores non-primitive or inherited fields', () => {
    renderSurface([{ ...TABLE, id: 'root' }], {
      results: [{ id: 'x', name: '<b>bold</b>', kind: { toString: 'evil' } }, { id: 'y', name: 'plain' }],
      emptyText: '',
    })
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
    expect(screen.getAllByRole('row')[1].textContent).not.toContain('evil')
  })

  it('treats a non-array rows value as empty', () => {
    renderSurface([{ ...TABLE, id: 'root' }], { results: 'not rows', emptyText: 'No matching files' })
    expect(screen.getByText('No matching files')).toBeInTheDocument()
  })

  it('renders basic catalog components alongside DataTable', async () => {
    const { view } = renderSurface(
      [
        { id: 'root', component: 'Column', children: ['title', 'table'] },
        { id: 'title', component: 'Text', variant: 'h3', text: 'Search files' },
        TABLE,
      ],
      { results: ROWS, emptyText: '' },
    )
    expect(view.container.querySelector('a2ui-basic-column')).not.toBeNull()
    await waitFor(() => expect(queryDeep(view.container, '[data-a2ui-datatable]')).not.toBeNull())
    expect(textDeep(view.container)).toContain('Search files')
    expect(textDeep(view.container)).toContain('invoice-2026-09.pdf')
  })

  it('never registers a markdown renderer, so lit never reaches unsafeHTML', () => {
    expect(getMarkdownRenderer()).toBeUndefined()
  })
})
