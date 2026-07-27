// Pure nav-ordering helper — the ONE way the console orders a product list within
// its scope. Dependency-free (no React, no registry import) so it is unit-testable
// and reused by the sidebar wherever product lists need a selected-first order.
//
// Directive (#58 §2.2): items are CONTINUOUS ALPHABETICAL; when an item is selected
// it is PINNED to the front (emphasized/highlighted, kept visible) and the rest stay
// alphabetical. `orderEntries(list, selectedId)` is that rule; `sortAlpha` is the
// plain alphabetical sort for lists with no selection concept.

type Labelled = { id: string; label: string }

/** Case-insensitive, locale-aware alphabetical sort by label (stable copy). */
export function sortAlpha<T extends Labelled>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

/**
 * Alphabetical order with the SELECTED item pinned first. The selected entry (if
 * present in the list) floats to the top so it stays visible + emphasized; every
 * other entry keeps the continuous alphabetical order. A null/absent selection is
 * plain alphabetical.
 */
export function orderEntries<T extends Labelled>(entries: readonly T[], selectedId?: string | null): T[] {
  const alpha = sortAlpha(entries)
  if (!selectedId) return alpha
  const idx = alpha.findIndex((e) => e.id === selectedId)
  if (idx <= 0) return alpha
  const [selected] = alpha.splice(idx, 1)
  return [selected, ...alpha]
}
