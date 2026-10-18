import { Catalog, type ComponentApi } from '@a2ui/web_core/v0_9'
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog'
import { A2UI_VERSION, TRUSTED_CATALOG_ID } from './messages.ts'

// Not needed by any tool, so not trusted: media players and agent-driven navigation.
export const EXCLUDED_BASIC_COMPONENTS: ReadonlySet<string> = new Set(['Video', 'AudioPlayer'])
export const EXCLUDED_BASIC_FUNCTIONS: ReadonlySet<string> = new Set(['openUrl'])

// The Trusted Catalog (CLAUDE.md §2): the official basic catalog minus exclusions, plus our
// custom components. Pass API objects in tests, React implementations in the app.
export function buildTrustedCatalog<T extends ComponentApi>(custom: readonly T[]) {
  const basic = [...basicCatalog.components.values()].filter((c) => !EXCLUDED_BASIC_COMPONENTS.has(c.name))
  const functions = [...basicCatalog.functions.values()].filter((f) => !EXCLUDED_BASIC_FUNCTIONS.has(f.name))
  return new Catalog<(typeof basic)[number] | T>(TRUSTED_CATALOG_ID, A2UI_VERSION, [...basic, ...custom], functions)
}
