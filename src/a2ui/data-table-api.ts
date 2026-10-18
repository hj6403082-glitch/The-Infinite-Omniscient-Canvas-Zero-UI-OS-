import { type ComponentApi, CommonSchemas } from '@a2ui/web_core/v0_9'
import { z } from 'zod'

// Plain identifiers only: no "__proto__", paths, spaces or markup in keys.
const Identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)

// Custom Trusted Catalog component: an interactive table whose rows come from the
// surface data model via a JSON Pointer binding (never inline from the agent).
export const DataTableApi = {
  name: 'DataTable',
  schema: z
    .object({
      accessibility: CommonSchemas.AccessibilityAttributes.optional(),
      weight: z.number().optional(),
      caption: CommonSchemas.DynamicString.optional(),
      columns: z
        .array(z.object({ key: Identifier, label: z.string().max(64) }).strict())
        .min(1)
        .max(8),
      rows: CommonSchemas.DataBinding,
      rowKey: Identifier,
      // Where the selected row's key is written before `action` is dispatched.
      selection: CommonSchemas.DataBinding.optional(),
      action: CommonSchemas.Action.optional(),
      emptyText: CommonSchemas.DynamicString.optional(),
    })
    .strict(),
} satisfies ComponentApi
