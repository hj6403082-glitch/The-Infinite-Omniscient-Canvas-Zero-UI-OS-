import { createBinderlessComponentImplementation } from '@a2ui/react/v0_9'
import type { Action, ComponentContext } from '@a2ui/web_core/v0_9'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { DataTableApi } from '../data-table-api.ts'
import './DataTable.css'

const MAX_RENDERED_ROWS = 200

// Subscribes to a literal-or-bound A2UI value through the surface's DataContext.
function useDynamicValue<T>(context: ComponentContext, value: unknown): T | undefined {
  const key = JSON.stringify(value)
  const store = useMemo(() => {
    if (value === undefined) return { subscribe: () => () => undefined, snapshot: () => undefined }
    let current: T | undefined = context.dataContext.resolveDynamicValue<T>(value)
    return {
      subscribe(onChange: () => void) {
        const subscription = context.dataContext.subscribeDynamicValue<T>(value, (next) => {
          current = next
          onChange()
        })
        current = subscription.value
        return () => subscription.unsubscribe()
      },
      snapshot: () => current,
    }
    // `key` tracks value changes; the identity of `value` may change on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, key])
  return useSyncExternalStore(store.subscribe, store.snapshot)
}

// Binderless components must resolve event context bindings (e.g. {path:'/selected'}) themselves.
function resolveAction(context: ComponentContext, action: Action): Action {
  if (!('event' in action)) return action
  const entries = Object.entries(action.event.context ?? {}).map(([key, value]) => [
    key,
    context.dataContext.resolveDynamicValue(value),
  ])
  return { event: { name: action.event.name, context: Object.fromEntries(entries) } }
}

// Own, primitive fields only: never prototype members, never objects rendered as text.
function cell(row: unknown, key: string): string {
  if (!row || typeof row !== 'object' || !Object.hasOwn(row, key)) return ''
  const value = (row as Record<string, unknown>)[key]
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

export const DataTable = createBinderlessComponentImplementation(DataTableApi, ({ context }) => {
  const parsed = DataTableApi.schema.safeParse(context.componentModel.properties)
  const props = parsed.success ? parsed.data : undefined
  const rowsValue = useDynamicValue<unknown>(context, props?.rows)
  const caption = useDynamicValue<string>(context, props?.caption)
  const emptyText = useDynamicValue<string>(context, props?.emptyText)
  const [selected, setSelected] = useState<string | null>(null)

  if (!props) return null
  const rows = (Array.isArray(rowsValue) ? rowsValue : []).slice(0, MAX_RENDERED_ROWS)
  const [first, ...rest] = props.columns

  const activate = (key: string) => {
    setSelected(key)
    if (props.selection) context.dataContext.set(props.selection.path, key)
    if (props.action) void context.dispatchAction(resolveAction(context, props.action))
  }

  return (
    <div className="a2ui-datatable" data-a2ui-datatable="">
      <table aria-label={typeof caption === 'string' ? caption : undefined}>
        {typeof caption === 'string' && <caption>{caption}</caption>}
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = cell(row, props.rowKey) || `row-${index}`
            return (
              <tr key={key} aria-selected={selected === key}>
                <td>
                  <button type="button" className="a2ui-datatable-open" onClick={() => activate(key)}>
                    {cell(row, first.key)}
                  </button>
                </td>
                {rest.map((column) => (
                  <td key={column.key}>{cell(row, column.key)}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && typeof emptyText === 'string' && <p className="a2ui-datatable-empty">{emptyText}</p>}
    </div>
  )
})
