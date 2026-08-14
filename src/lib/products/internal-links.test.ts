import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { SLUG_ALIASES } from './match-core'

/**
 * Every address the console links to itself must be one the console serves.
 *
 * Three shipped links pointed at nothing. `/discover` was the SECOND button on the
 * "No such page" screen — the page whose whole job is to explain a dead link ended on
 * one. `/referrals/history` and `/referrals/earnings` were the module's own tabs. And
 * a deploy row for an app opened `/app-platform/<slug>`, an address the registry never
 * declared. Each one renders the 404 that tells the reader "the link is wrong — that
 * is worth reporting", which is true, and was nobody's job to notice.
 *
 * So this reads the SOURCE and diffs intent against the catalog: every internal
 * `router.push('/x')` / `href="/x"` literal must have a first segment the console can
 * resolve. Read as text, not imported, for the reason `reserved-routes.test.ts` gives:
 * the registry cannot be loaded under vitest (icon ESM), and a fixture mirroring it
 * proves nothing about the file that ships.
 *
 * SCOPE, stated honestly: this asserts on the first segment — "is this a product the
 * console has?" — which is the class that produced `/discover`, `/keys` and `/login`.
 * A wrong SUB-path under a real product (`/app-platform/<slug>`) is a different class
 * and is not caught here; those are pinned by the module's own routing tests.
 */
const SRC = join(__dirname, '..', '..')
const REGISTRY = readFileSync(join(__dirname, 'registry.tsx'), 'utf8')
const APP = join(SRC, '..', 'app')

/** Every `id: '…'` the catalog declares — the addresses a module entry claims. */
const catalogIds = new Set([...REGISTRY.matchAll(/^\s{4}id: '([a-z0-9-]+)',$/gm)].map((m) => m[1]))

/** Top-level directories under `app/` — real filesystem routes (`/signin`, `/docs`, …). */
const appRoutes = new Set(
  readdirSync(APP)
    .filter((e) => statSync(join(APP, e)).isDirectory())
    .filter((e) => !e.startsWith('(') && !e.startsWith('_') && !e.startsWith('['))
    .concat(['auth']),
)

/** Segments that are addresses without being products. */
const EXTRA = new Set([
  '', // "/" — the home board
  'category', // `/category/:slug` — the catalog category screen
  'discover', // `/discover/:id` — the per-product interstitial (there is NO index)
  'v1', // API calls, not navigations
])

const known = (seg: string): boolean =>
  catalogIds.has(seg) || appRoutes.has(seg) || EXTRA.has(seg) || seg in SLUG_ALIASES

/** Recursively collect `.ts`/`.tsx` under a directory. */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p)
  }
  return out
}

/** Internal navigation literals: `router.push('/x')`, `push('/x')`, `href="/x"`. */
const LINK = /(?:router\.push|\bpush|\breplace)\(\s*'(\/[^'`${}]*)'|href=["'](\/[^"'`${}]*)["']/g

type Found = { path: string; file: string }

const attempted: Found[] = []
for (const file of sources(join(SRC, 'components')).concat(sources(join(SRC, 'entry')))) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(LINK)) {
    const path = (m[1] ?? m[2]) as string
    if (path.startsWith('/v1/')) continue // API, not a navigation
    attempted.push({ path, file: file.slice(SRC.length + 1) })
  }
}

describe('internal links resolve to addresses the console actually serves', () => {
  it('finds link literals to check (the sweep is not vacuously passing)', () => {
    expect(attempted.length).toBeGreaterThan(20)
  })

  it('every linked first segment is a product, an app route, or an alias', () => {
    const broken = attempted
      .filter(({ path }) => !known(path.split('/')[1] ?? ''))
      .map(({ path, file }) => `${path}  ←  ${file}`)
    expect(broken).toEqual([])
  })

  // The specific regressions, named so a reintroduction reads as itself.
  it('the "No such page" screen does not itself link to a dead address', () => {
    const notFound = readFileSync(join(SRC, 'components', 'NotFound.tsx'), 'utf8')
    expect(notFound).not.toContain("push('/discover')")
  })

  it('nothing links to /keys — the key surface is /api-keys', () => {
    expect(attempted.map((a) => a.path)).not.toContain('/keys')
    expect(catalogIds.has('api-keys')).toBe(true)
  })

  it('nothing links to /login — the console has no such route', () => {
    expect(attempted.map((a) => a.path)).not.toContain('/login')
  })
})
