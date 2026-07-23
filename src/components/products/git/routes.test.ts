import { describe, expect, it } from 'vitest'

import { resolveRoute } from '~/lib/products/match-core'
import type { ProductModule } from '~/lib/products/registry'

// The exact route shape the unified Code hub registers (hub · tab · repo browser).
// `component` is irrelevant to routing (erased) — a stub keeps this test free of the
// icon-ESM registry runtime, per the repo convention. This pins the contract CodeModule
// reads: `/code` → hub (default tab), `/code/:tab` → the face, `/code/repos/:name` → the
// browser with params.name (the reused git/ RepoBrowser). The three are unambiguous by
// exact segment count.
// Cast via `unknown`: routing reads only `id` + `routes`; `icon`/`description` (required
// by ProductModule but ESM-icon-bound) are intentionally omitted so the test stays free
// of the registry runtime.
const codeModule: ProductModule = {
  id: 'code',
  label: 'Code',
  routes: [
    { path: '', component: (() => null) as never },
    { path: ':tab', component: (() => null) as never },
    { path: 'repos/:name', component: (() => null) as never },
  ],
} as unknown as ProductModule

describe('code hub routing contract', () => {
  it('/code resolves the hub index (no tab, no name)', () => {
    const m = resolveRoute([codeModule], ['code'])
    expect(m?.route.path).toBe('')
    expect(m?.params.tab).toBeUndefined()
    expect(m?.params.name).toBeUndefined()
  })

  it('/code/:tab resolves a face (repos | search | ask)', () => {
    for (const tab of ['repos', 'search', 'ask']) {
      const m = resolveRoute([codeModule], ['code', tab])
      expect(m?.route.path).toBe(':tab')
      expect(m?.params.tab).toBe(tab)
      expect(m?.params.name).toBeUndefined()
    }
  })

  it('/code/repos/:name resolves the repo browser with the repo name', () => {
    const m = resolveRoute([codeModule], ['code', 'repos', 'my-repo'])
    expect(m?.route.path).toBe('repos/:name')
    expect(m?.params.name).toBe('my-repo')
  })

  it('a repo name is one segment — deeper file paths ride the URL query, not a route', () => {
    // repos/:name matches exactly 3 segments; anything deeper is NOT a route match
    // (the browser holds ref/path/view in ?query, so a nested file never 404s here).
    expect(resolveRoute([codeModule], ['code', 'repos', 'my-repo', 'tree'])).toBeNull()
  })
})
