import { describe, expect, it } from 'vitest'

import { resolveRoute } from '~/lib/products/match-core'
import type { ProductModule } from '~/lib/products/registry'

// The exact route shape the git entry registers (list + repo browser). `component`
// is irrelevant to routing (erased) — a stub keeps this test free of the icon-ESM
// registry runtime, per the repo convention. This pins the contract GitModule reads:
// `/git` → index (no name), `/git/:name` → the browser with params.name.
// Cast via `unknown`: routing reads only `id` + `routes`; `icon`/`description`
// (required by ProductModule but ESM-icon-bound) are intentionally omitted so the
// test stays free of the registry runtime, per the repo convention.
const gitModule: ProductModule = {
  id: 'git',
  label: 'Git',
  routes: [
    { path: '', component: (() => null) as never },
    { path: ':name', component: (() => null) as never },
  ],
} as unknown as ProductModule

describe('git routing contract', () => {
  it('/git resolves the index route (no name)', () => {
    const m = resolveRoute([gitModule], ['git'])
    expect(m?.route.path).toBe('')
    expect(m?.params.name).toBeUndefined()
  })

  it('/git/:name resolves the browser with the repo name', () => {
    const m = resolveRoute([gitModule], ['git', 'my-repo'])
    expect(m?.route.path).toBe(':name')
    expect(m?.params.name).toBe('my-repo')
  })

  it('a repo name is one segment — deeper file paths ride the URL query, not a route', () => {
    // /git/:name matches exactly 2 segments; anything deeper is NOT a route match
    // (the browser holds ref/path/view in ?query, so a nested file never 404s here).
    expect(resolveRoute([gitModule], ['git', 'my-repo', 'tree'])).toBeNull()
  })
})
