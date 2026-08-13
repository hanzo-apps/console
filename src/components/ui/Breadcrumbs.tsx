'use client'

/**
 * Breadcrumbs — where you are, derived from the route + the catalog. The path
 * `/vector/my-db` reads Home / Data / Vector / my-db: the product's category and
 * label come from its catalog entry (so a new product gets correct crumbs for
 * free), and trailing segments are the detail params. Links jump; the category
 * and the current leaf are plain text. Nothing renders on the home route.
 */
import { usePathname, useRouter } from 'next/navigation'
import { Text, XStack } from '@hanzo/gui'
import { ChevronRight } from '@hanzogui/lucide-icons-2'

import { findEntry, categoryFromSlug } from '~/lib/products/registry'
import { productSubpages, resolveView } from '~/lib/products/match'
import { canonicalSlug } from '~/lib/products/match-core'

export type Crumb = { label: string; href?: string }

/**
 * The trail for a path. Exported because it is the whole decision — the render
 * below is a map over it — and because one line of it was a lie worth locking
 * down: an unresolvable head used to be spelled out segment by segment, so
 * `/login` (a sibling app's redirect that this console does not serve) read
 * `Home / login`, as if login were a place here. A trail is a claim about where
 * you are, and there is nowhere to be at an address that resolves to nothing.
 */
export function crumbsFor(pathname: string): Crumb[] {
  const segs = pathname.split('/').filter(Boolean)
  const crumbs: Crumb[] = [{ label: 'Home', href: '/' }]
  if (segs.length === 0) return crumbs

  if (segs[0] === 'discover') {
    crumbs.push({ label: 'Discover' })
    const e = segs[1] ? findEntry(segs[1]) : undefined
    if (e) crumbs.push({ label: e.label })
    else if (segs[1]) crumbs.push({ label: decodeURIComponent(segs[1]) })
    return crumbs
  }

  if (segs[0] === 'category') {
    crumbs.push({ label: 'Category' })
    const cat = segs[1] ? categoryFromSlug(segs[1]) : null
    if (cat) crumbs.push({ label: cat })
    else if (segs[1]) crumbs.push({ label: decodeURIComponent(segs[1]) })
    return crumbs
  }

  // The SAME resolver the page renders from, so the trail and the page can never
  // disagree about whether the address exists. It also canonicalizes an alias
  // (`/traces` → o11y), which is why the head is read from `canonicalSlug` below
  // rather than from the raw segments — spelling the alias out was how `Traces`
  // read as `traces`.
  if (resolveView(segs).kind === 'notfound') {
    crumbs.push({ label: 'Not found' })
    return crumbs
  }

  const canon = canonicalSlug(segs)
  const entry = findEntry(canon[0])
  if (entry) {
    // Skip the category crumb when it just repeats the product's own name — the
    // `Settings` product lives in the `Settings` category, and `Home / Settings /
    // Settings / …` says the same word twice.
    if (entry.category !== entry.label) crumbs.push({ label: entry.category })
    crumbs.push({ label: entry.label, href: canon.length > 1 ? `/${entry.id}` : undefined })
    // Label trailing segments from the product's own sub-page list (so `/settings/logs`
    // reads `… / Logs`, not the raw slug); detail params that aren't sub-pages pass through.
    const subs = productSubpages(entry)
    for (let i = 1; i < canon.length; i++) {
      const sp = subs.find((s) => s.slug === canon[i])
      crumbs.push({ label: sp ? sp.label : decodeURIComponent(canon[i]) })
    }
  }
  return crumbs
}

export function Breadcrumbs() {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const crumbs = crumbsFor(pathname)
  if (crumbs.length <= 1) return null

  return (
    <XStack items="center" gap="$1.5" flexWrap="wrap">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1
        return (
          <XStack key={`${c.label}-${i}`} items="center" gap="$1.5">
            {i > 0 ? <ChevronRight size={13} opacity={0.4} /> : null}
            {c.href && !last ? (
              <Text
                fontSize="$2"
                color="$color11"
                hoverStyle={{ color: '$color12' }}
                cursor="pointer"
                onPress={() => router.push(c.href!)}
              >
                {c.label}
              </Text>
            ) : (
              <Text fontSize="$2" color={last ? '$color12' : '$color10'} fontWeight={last ? '600' : '400'}>
                {c.label}
              </Text>
            )}
          </XStack>
        )
      })}
    </XStack>
  )
}
