import { a2ui, jsonPointer } from '../a2ui/messages.ts'
import type { FileIndex } from './file-index.ts'
import type { ToolDefinition } from './types.ts'

export function createSearchFilesTool(index: FileIndex): ToolDefinition {
  return {
    name: 'searchFiles',
    async run({ surfaceId, emit, signal, openFile }, { query }) {
      // Static component tree; everything user- or data-derived lives in the data model.
      emit(
        a2ui.updateComponents(surfaceId, [
          { id: 'root', component: 'Column', children: ['title', 'query', 'status', 'table'] },
          { id: 'title', component: 'Text', variant: 'h3', text: 'Search files' },
          { id: 'query', component: 'Text', variant: 'caption', text: { path: '/query' } },
          { id: 'status', component: 'Text', variant: 'body', text: { path: '/status' } },
          {
            id: 'table',
            component: 'DataTable',
            caption: 'Matching files',
            columns: [
              { key: 'name', label: 'Name' },
              { key: 'kind', label: 'Kind' },
              { key: 'modified', label: 'Modified' },
              { key: 'size', label: 'Size' },
            ],
            rows: { path: '/results' },
            rowKey: 'id',
            selection: { path: '/selected' },
            action: { event: { name: 'openFile', context: { fileId: { path: '/selected' } } } },
            emptyText: { path: '/emptyText' },
          },
        ]),
        a2ui.updateDataModel(surfaceId, jsonPointer(), {
          query,
          status: 'Searching files…',
          loading: true,
          results: [],
          selected: null,
          emptyText: 'Searching…',
        }),
      )

      const results = await index.search(query, signal)
      signal.throwIfAborted()
      emit(
        a2ui.updateDataModel(surfaceId, jsonPointer('results'), results),
        a2ui.updateDataModel(surfaceId, jsonPointer('loading'), false),
        a2ui.updateDataModel(surfaceId, jsonPointer('emptyText'), 'No matching files'),
        a2ui.updateDataModel(
          surfaceId,
          jsonPointer('status'),
          `${results.length} ${results.length === 1 ? 'file matches' : 'files match'}`,
        ),
      )

      return {
        // Opening a file is the task's terminal action.
        onAction: (name, context) => {
          const fileId = context.fileId
          if (name !== 'openFile' || typeof fileId !== 'string' || !index.has(fileId)) return 'continue'
          openFile(fileId)
          return 'complete'
        },
      }
    },
  }
}
