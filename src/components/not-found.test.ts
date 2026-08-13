import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

/**
 * An address that resolves to nothing must SAY so.
 *
 * The console had no 404. Every unknown address rendered the home board with the
 * unknown words in the breadcrumb, so a typo and a broken link produced the same
 * screen — and that screen looked like it had worked. What it hid, measured on
 * console.hanzo.ai: the Tracker nav item leaves the console entirely (the cloud
 * binary answers `/tracker` at this host with its own SPA), that SPA redirects to
 * `/login`, and `/login` came back as the dashboard. Three navigations, no error,
 * and the person's conclusion was "Tracker opens the dashboard".
 *
 * READ AS SOURCE, NOT IMPORTED, the same way `products/reserved-routes.test.ts`
 * reads the registry: these three files are 'use client' React that pulls in the
 * icon ESM the vitest env cannot load, and a fixture mirroring them would prove
 * something about the fixture. The contract they share is small enough to state as
 * text, and the file that ships is the only file worth asserting about.
 */
const ROOT = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const HOME = 'app/(dashboard)/page.tsx'
const RENDERER = 'src/components/ProductRoute.tsx'
const TRAIL = 'src/components/ui/Breadcrumbs.tsx'

describe('the home page owns the root and nothing else', () => {
  const src = read(HOME)

  it('hands EVERY non-root address to the one renderer', () => {
    // The static embed serves this page's index.html for every path, so this hand-off
    // IS routing in production.
    expect(src).toMatch(/if \(segments\.length > 0\) return <ProductRoute slug=\{segments\} \/>/)
  })

  it('does not resolve routes itself — that is the renderer\'s single job', () => {
    // It used to call `resolveView` and fall through to the board when the answer was
    // `notfound`, which is precisely how an unknown address rendered the home screen.
    expect(src).not.toMatch(/resolveView/)
  })
})

describe('the renderer answers an unresolved address', () => {
  const src = read(RENDERER)

  it('renders the NotFound surface for a notfound view', () => {
    expect(src).toMatch(/view\.kind === 'notfound'\) return <NotFound/)
  })

  it("does not throw Next's notFound() — the embed has no server render to catch it", () => {
    // In the one-binary build the cloud binary answers every path with the same
    // index.html; there is no server render to carry a 404 status, and the throw
    // would only trade the shell (and the way back) for a bare page.
    // It cannot be called without being imported, so the import is the assertion.
    expect(src).not.toMatch(/import \{[^}]*\bnotFound\b[^}]*\} from 'next\/navigation'/)
  })
})

describe('the breadcrumb trail never claims an address that resolves to nothing', () => {
  const src = read(TRAIL)

  it('says Not found instead of spelling the unknown segments out', () => {
    expect(src).toMatch(/label: 'Not found'/)
    expect(src).not.toMatch(/for \(const s of segs\) crumbs\.push/)
  })

  it('resolves the address the same way the page does (one resolver, no second rule)', () => {
    expect(src).toMatch(/resolveView\(segs\)\.kind === 'notfound'/)
  })
})

describe('the surface names the address it could not resolve', () => {
  const src = read('src/components/NotFound.tsx')

  it('prints the address back, decoded — the address is the evidence', () => {
    // A word you did not type is a link that is wrong, not a key you mistyped; the
    // surface can only carry that distinction if it shows what it was asked for.
    expect(src).toMatch(/slug\.map\(decodeURIComponent\)\.join\('\/'\)/)
    expect(src).toMatch(/\$\{address\}/)
  })

  it('the reader itself can fail (negative control)', () => {
    expect(() => read('src/components/definitely-not-a-file.tsx')).toThrow()
  })
})
