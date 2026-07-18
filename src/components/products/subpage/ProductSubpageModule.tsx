'use client'

/**
 * The ONE shared per-product sub-page system. Every product's uniform base
 * sub-pages — Status · Logs · Metrics · Settings — render through here, scoped to
 * the product and backed by its REAL feed (or an honest state), driven by the
 * per-product metadata in `sources.ts`. There is exactly one way to render a
 * per-product sub-page; adding a product needs zero new pages.
 *
 * The catch-all resolves a base sub-page to `{ kind: 'subpage', entry, subpage }`
 * (see `match-core.resolveProductView`) and renders this — so a tabbed product's
 * `:tab` route can never swallow Status/Logs/Metrics into its default tab, and a
 * single-screen product never falls to a dead placeholder for these slugs.
 */
import type { CatalogEntry, ProductSubpage } from '~/lib/products/registry'
import { ProductStatusView } from './ProductStatusView'
import { ProductLogsView } from './ProductLogsView'
import { ProductMetricsView } from './ProductMetricsView'
import { ProductSettingsView } from './ProductSettingsView'
import { ProductSubpageStub } from '../ProductSubpageStub'

export function ProductSubpageModule({ entry, subpage }: { entry: CatalogEntry; subpage: ProductSubpage }) {
  switch (subpage.slug) {
    case 'status':
      return <ProductStatusView entry={entry} />
    case 'logs':
      return <ProductLogsView entry={entry} />
    case 'metrics':
      return <ProductMetricsView entry={entry} />
    case 'settings':
      return <ProductSettingsView entry={entry} />
    default:
      // Defensive: only base slugs route here, but an unexpected slug stays honest.
      return <ProductSubpageStub entry={entry} subpage={subpage} />
  }
}

