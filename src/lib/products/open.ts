/**
 * Open a catalog entry. Every product is a native in-console route now (there is
 * no external link-out), so opening anything is one thing: navigate to its route.
 * Takes a `push` so this stays free of any router dependency.
 */
import type { CatalogEntry } from './registry'

export function openProduct(entry: CatalogEntry, push: (path: string) => void): void {
  push(`/${entry.id}`)
}
