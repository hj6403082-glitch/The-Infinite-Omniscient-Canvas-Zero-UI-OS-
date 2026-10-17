// A2UI v0.9 message builders. Worker-safe: type-only imports from @a2ui/web_core.
import type { A2uiMessage } from '@a2ui/web_core/v0_9'

export const A2UI_VERSION = 'v0.9'
export const TRUSTED_CATALOG_ID = 'urn:infinite-canvas:catalog:trusted:v1'

// One node of a surface's flat adjacency list: children reference other nodes by id.
export interface ComponentSpec {
  id: string
  component: string
  [property: string]: unknown
}

// RFC 6901 JSON Pointer; the A2UI data model root is "/".
export function jsonPointer(...segments: (string | number)[]): string {
  if (segments.length === 0) return '/'
  return segments.map((s) => '/' + String(s).replaceAll('~', '~0').replaceAll('/', '~1')).join('')
}

export const a2ui = {
  createSurface(surfaceId: string): A2uiMessage {
    return { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: TRUSTED_CATALOG_ID } }
  },
  updateComponents(surfaceId: string, components: ComponentSpec[]): A2uiMessage {
    return { version: A2UI_VERSION, updateComponents: { surfaceId, components } }
  },
  updateDataModel(surfaceId: string, path: string, value: unknown): A2uiMessage {
    return { version: A2UI_VERSION, updateDataModel: { surfaceId, path, value } }
  },
  deleteSurface(surfaceId: string): A2uiMessage {
    return { version: A2UI_VERSION, deleteSurface: { surfaceId } }
  },
}
