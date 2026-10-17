import type { ReactCatalogComponent } from '@a2ui/react/v0_9'
import { buildTrustedCatalog } from './catalog-spec.ts'
import { DataTable } from './components/DataTable.tsx'

// The app's Trusted Catalog: reviewed basic components plus our React DataTable.
export const trustedCatalog = buildTrustedCatalog<ReactCatalogComponent>([DataTable])
