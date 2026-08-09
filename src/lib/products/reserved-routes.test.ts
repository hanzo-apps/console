import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

/**
 * A module entry renders at its own id, so the catalog decides which addresses
 * the console CLAIMS. Some addresses are not the console's to claim: another
 * service answers them at the same host, before the SPA router is reached.
 *
 * When that happens the failure is not a blank panel inside the shell — the nav
 * item leaves the console entirely. `/api` returned a bare text/plain 404 from
 * the router, no shell, no way back but the browser's Back button, because
 * `/api` is IAM's legacy surface (HIP-0111 retires it for `/v1/iam/*`). `/apiz`
 * rendered perfectly, which is the tell: an exact-prefix claim by something
 * else, not a routing miss of ours.
 *
 * Reserved does not mean "never link to it" — it means never claim it as an
 * in-console MODULE. An `external` entry pointing at the same word is correct,
 * and is what the API reference is: a document on docs.hanzo.ai opened in a tab.
 *
 * READ AS SOURCE, NOT IMPORTED, and that is not laziness. The registry cannot be
 * loaded in vitest at all (icon ESM) — which is why its siblings test fixtures
 * that MIRROR real entries. A fixture cannot catch this bug: the mistake is in
 * the real entry, and a copy of it that someone kept correct proves nothing
 * about the file that ships. Reading the file is the only way to assert about
 * the file.
 */
const REGISTRY = join(__dirname, 'registry.tsx')

/** id -> why the console must not render a module there. */
const RESERVED = new Map<string, string>([
  ['api', "IAM's legacy surface answers /api at this host (HIP-0111 retires it), so a module there is unreachable"],
])

/** The `{ ... }` catalog entry that declares `id: '<id>'`, as source text. */
function entrySource(src: string, id: string): string {
  const at = src.indexOf(`id: '${id}',`)
  if (at === -1) throw new Error(`no catalog entry declares id: '${id}'`)
  const open = src.lastIndexOf('{', at)
  // Entries are flat object literals in a top-level array; the first line that
  // closes at the entry's own indentation ends it.
  const end = src.indexOf('\n  },', at)
  return src.slice(open, end === -1 ? src.length : end)
}

describe('the catalog does not claim an address another service answers', () => {
  const src = readFileSync(REGISTRY, 'utf8')

  for (const [id, why] of RESERVED) {
    it(`'${id}' is not an in-console module — ${why}`, () => {
      const entry = entrySource(src, id)
      expect(entry).not.toMatch(/kind: 'module'/)
      expect(entry).toMatch(/kind: 'external'/)
    })

    it(`'${id}' opens a real document, not a console path`, () => {
      const entry = entrySource(src, id)
      // href must resolve to the docs constant, never a relative in-console path
      // — a relative href would be the same bug wearing a different kind.
      expect(entry).toMatch(/href: ext\./)
      expect(entry).not.toMatch(/href: '\//)
    })
  }

  it('the guard itself can find an entry (negative control)', () => {
    expect(() => entrySource(src, 'definitely-not-a-product')).toThrow()
    expect(entrySource(src, 'api')).toContain("id: 'api'")
  })
})
