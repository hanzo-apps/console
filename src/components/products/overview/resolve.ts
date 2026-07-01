/**
 * Resolve the native-overview content for a catalog entry. Returns the registered
 * `OverviewSpec` when one exists, else a sensible spec DERIVED from the catalog
 * metadata alone — so every product gets a real in-console overview with no blank
 * page and no external bounce, whether or not it has bespoke content yet.
 *
 * Pure (no GUI), so the shell stays presentational and this is unit-testable.
 */
import type { CatalogEntry } from '~/lib/products/registry'
import { OVERVIEW_SPECS, type OverviewSpec } from './spec'

/** Build an honest fallback spec from the catalog entry's own fields. */
export function defaultSpec(entry: CatalogEntry): OverviewSpec {
  const facts: OverviewSpec['facts'] = [{ label: 'Category', value: entry.category }]
  if (entry.gcp) facts.push({ label: 'Equivalent to', value: entry.gcp })
  if (entry.repo) facts.push({ label: 'Open source', value: entry.repo })

  return {
    summary: entry.description,
    // No bespoke health source declared → omit the band rather than fake it.
    health: { kind: 'none' },
    facts,
    actions: [],
    docs: [
      {
        heading: `About ${entry.label}`,
        body: entry.description,
      },
    ],
  }
}

/** The native-overview spec for an entry: registered content, or the derived default. */
export function resolveSpec(entry: CatalogEntry): OverviewSpec {
  return OVERVIEW_SPECS[entry.id] ?? defaultSpec(entry)
}
