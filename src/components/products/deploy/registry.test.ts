/**
 * The Deploy front door's catalog declaration, pinned against the real source.
 *
 * `registry.tsx` cannot be imported here — it pulls the icon ESM the runner can't
 * load — so the house pattern applies (see lib/products/sentry-scope.test.ts):
 * read the entry's own flags off the SOURCE, and prove the predicates that consume
 * them with fixtures elsewhere (`match-core.test.ts` owns the routing algorithm).
 * A fixture proves the predicate; only the source proves the DATA, and the data is
 * what a later edit breaks.
 *
 * Each fact here has already been a bug shape in this console:
 *  - a `deploy` SLUG_ALIAS makes the front door unreachable, because
 *    `canonicalSlug` rewrites the head before any lookup happens;
 *  - a `stage: 'admin'` on a customer surface hides it from every customer;
 *  - two entries named "Deploy" put identically-named rows in one nav section,
 *    one of them the admin ESTATE map;
 *  - a sub-page with no `:tab` route renders an honest stub, and nothing fails.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SLUG_ALIASES } from '~/lib/products/match-core'
import { labelOf } from '~/lib/products/served'
import type { Stage } from '~/lib/products/stage'

const SRC = readFileSync(join(__dirname, '..', '..', '..', 'lib', 'products', 'registry.tsx'), 'utf8')

/**
 * A row's display name, computed the way the catalog computes it: the label the
 * row types, else the name its id reads as. A row does not type a label it would
 * only be repeating, so asserting on `label:` text alone would now miss most of
 * the catalogue — including both products this file exists to pin.
 */
const nameIn = (id: string, src: string): string =>
  labelOf({ id, label: (src.match(/^\s*label: '(.*)',\s*$/m) ?? [])[1] })

/** Every row's display name, in catalog order. */
const names = (): string[] =>
  [...SRC.matchAll(/^ {4}id: '([^']+)',$/gm)].map((m) => nameIn(m[1], entrySrc(m[1])))

/** The stage an entry's source declares, read the way `stageOf` reads the value:
 *  unset is `ga`. This is the DATA half — the predicate over it is proved with
 *  fixtures in stage.test.ts. */
function stageIn(src: string): Stage {
  const m = src.match(/^\s*stage: '(ga|beta|alpha|admin)',\s*$/m)
  return (m?.[1] as Stage) ?? 'ga'
}

/** One catalog entry's source text: from its `id:` to the next entry's. */
function entrySrc(id: string): string {
  const at = SRC.indexOf(`id: '${id}',`)
  expect(at, `catalog entry '${id}' not found in registry.tsx`).toBeGreaterThan(-1)
  const next = SRC.indexOf("\n    id: '", at + 1)
  return SRC.slice(at, next === -1 ? SRC.length : next)
}

describe('the Deploy product', () => {
  const src = entrySrc('deploy')

  it('is an Infrastructure module named Deploy', () => {
    expect(nameIn('deploy', src)).toBe('Deploy')
    expect(src).toMatch(/^\s*category: 'Infrastructure',\s*$/m)
    expect(src).toMatch(/^\s*kind: 'module',\s*$/m)
  })

  it('is GA — a customer ships their own code', () => {
    expect(stageIn(src)).toBe('ga')
  })

  it('declares the index and the :tab route its sub-pages need', () => {
    expect(src).toMatch(/\{ path: '', component: DeployModule \}/)
    expect(src).toMatch(/\{ path: ':tab', component: DeployModule \}/)
  })

  it('declares exactly the six sub-pages the module dispatches on', () => {
    const slugs = [...src.matchAll(/\{ slug: '([a-z]+)', label:/g)].map((m) => m[1])
    expect(slugs).toEqual(['apps', 'sites', 'domains', 'cd', 'ci', 'storage'])
  })

  it('is the ONE entry named Deploy in the whole catalog', () => {
    expect(names().filter((n) => n === 'Deploy')).toHaveLength(1)
  })
})

describe('/deploy resolves to the front door', () => {
  it('has no alias shadowing the head', () => {
    // `canonicalSlug` rewrites the FIRST segment unconditionally, so an alias
    // named `deploy` would route the front door's own URL somewhere else.
    expect(SLUG_ALIASES.deploy).toBeUndefined()
  })

  it('leaves App Platform addressable under its own id', () => {
    expect(SLUG_ALIASES['app-platform']).toBeUndefined()
    expect(nameIn('app-platform', entrySrc('app-platform'))).toBe('App Platform')
  })
})

describe('the estate fleet map stays admin-only, under its own name', () => {
  const src = entrySrc('gitops')

  it('is named Fleet, not Deploy', () => {
    expect(nameIn('gitops', src)).toBe('Fleet')
  })

  it('is still admin-gated — it shows every org, not just yours', () => {
    expect(stageIn(src)).toBe('admin')
  })
})
