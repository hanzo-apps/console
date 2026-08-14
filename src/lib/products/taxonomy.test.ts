import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { categoryOrder, PUBLIC_CATEGORIES, CATEGORY_SUMMARY } from './brand-scope'

/**
 * The taxonomy is TEN categories, and a fold never loses a product.
 *
 * Two failures this catches, neither of which the compiler can:
 *
 *  1. A category left out of `categoryOrder` while its name stays in the union.
 *     `categoriesForBrand` filters BY that array, so every consumer — nav, ⌘K,
 *     the category pages, the catalog home — silently stops showing that
 *     category's products. Nothing fails to compile; the products just leave.
 *
 *  2. A category folded away (Training → AI, Dev → Platform, Billing →
 *     Commerce) without re-homing the entries that named it. tsc does catch the
 *     literal, so this reads the SHIPPED registry instead of asserting the type:
 *     it is the count that has to survive, not the spelling.
 *
 * READ AS SOURCE, NOT IMPORTED, and that is not laziness — the same reason
 * reserved-routes.test.ts gives. The registry cannot be loaded in vitest at all
 * (icon ESM), and its siblings therefore test fixtures that MIRROR real entries.
 * A fixture cannot catch either failure above: both are mistakes in the real
 * file, and a copy someone kept correct proves nothing about the file that
 * ships. Reading the file is the only way to assert about the file.
 */
const REGISTRY = join(__dirname, 'registry.tsx')

/** Every `category: '<name>'` the shipped catalog declares, counted by name. */
function categoryCounts(src: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [, name] of src.matchAll(/^ {4}category: '([A-Za-z0-9]+)',$/gm)) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

describe('the product taxonomy', () => {
  const src = readFileSync(REGISTRY, 'utf8')
  const counts = categoryCounts(src)

  it('is exactly ten categories a customer browses, plus Settings', () => {
    expect(PUBLIC_CATEGORIES).toHaveLength(10)
    expect(categoryOrder).toEqual([...PUBLIC_CATEGORIES, 'Settings'])
  })

  it('gives every category one line of its own', () => {
    for (const category of categoryOrder) {
      expect(CATEGORY_SUMMARY[category], `${category} has no summary`).toBeTruthy()
    }
    expect(Object.keys(CATEGORY_SUMMARY).sort()).toEqual([...categoryOrder].sort())
  })

  it('leaves no product in a category the console does not show', () => {
    const orphans = [...counts.keys()].filter((c) => !categoryOrder.includes(c as never))
    expect(orphans, `${orphans.join(', ')} holds products but is not in categoryOrder`).toEqual([])
  })

  it('shows no empty category', () => {
    const empty = categoryOrder.filter((c) => !counts.get(c))
    expect(empty, `${empty.join(', ')} is displayed but holds no product`).toEqual([])
  })

  it('reads the real catalog (negative control)', () => {
    // Every entry declares exactly one category, so the counts must total the
    // entries. A regex that matched nothing would pass every test above.
    const entries = src.match(/^ {4}id: '/gm)?.length ?? 0
    const counted = [...counts.values()].reduce((n, c) => n + c, 0)
    expect(entries).toBeGreaterThan(150)
    expect(counted).toBe(entries)
  })
})
