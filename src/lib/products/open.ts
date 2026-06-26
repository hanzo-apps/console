/**
 * Open a catalog entry. The ONE place that knows how each kind opens:
 * in-console modules navigate via the router; external surfaces open in a new
 * tab. Takes a `push` so this stays free of any router dependency.
 */
import type { CatalogEntry } from './registry'

export function openProduct(entry: CatalogEntry, push: (path: string) => void): void {
  if (entry.kind === 'external') {
    if (typeof window !== 'undefined') window.open(entry.href, '_blank', 'noopener')
    return
  }
  push(`/${entry.id}`)
}
