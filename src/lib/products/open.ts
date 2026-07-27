/**
 * Open a catalog entry — the ONE opener every surface (nav, ⌘K,
 * category page, level-2 siblings) routes through, so opening is defined in one
 * place. Discriminates on `kind`:
 *  - `module`   : navigate to its in-console route (`/<id>`).
 *  - `external` : open its deployed app (`href`) in a new tab (the Lux/Zoo
 *                 chain-app launch tiles). `noopener` for a safe cross-origin tab.
 * Takes a `push` so this stays free of any router dependency (a `module` uses it;
 * an `external` ignores it).
 */
import type { CatalogEntry } from './registry'

export function openProduct(entry: CatalogEntry, push: (path: string) => void): void {
  if (entry.kind === 'external') {
    if (typeof window !== 'undefined') window.open(entry.href, '_blank', 'noopener')
    return
  }
  push(`/${entry.id}`)
}
