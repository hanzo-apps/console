'use client'

/**
 * Navigation — the ONE way this app changes screens.
 *
 * The console is a single page. Production serves ONE index.html for every address
 * (a static export cannot pre-generate arbitrary product slugs), and the app resolves
 * the screen from `usePathname()`. Next's own `router.push` cannot navigate that: it
 * must fetch an RSC payload for the target route, and a static host has none to give.
 * Measured on console.hanzo.ai — `GET /profile` carrying `RSC: 1` answers
 * `content-type: text/html`, the SPA shell, and there is no `/profile.txt` beside it.
 * `fetchServerResponse` sees a response that is not a flight payload and falls back to
 * an MPA navigation: `window.location.href = href`. That is a full document load, and
 * it was EVERY navigation in the app — which is why clicking Profile in the account
 * menu reloaded the whole console: every provider remounted, the session refetched,
 * and the screen went white on the way.
 *
 * So navigation here is what it is in any single-page app: a change of address. Next
 * PATCHES `window.history.pushState` (`client/components/app-router.js`) to dispatch
 * `ACTION_RESTORE` with the CURRENT tree, so `usePathname` and `useSearchParams` hold
 * the new address with no fetch, no route change and nothing unmounted; it also copies
 * its own `__NA` marker onto the new entry, so Back and Forward stay client-side too.
 * Using the platform's own history API is what makes that work — it is not a bypass.
 *
 * Only the two calls that MOVE the app are ours. `back`, `forward`, `refresh` and
 * `prefetch` are Next's own, untouched. Callers write the `router.push(path)` they
 * always wrote; the import is the only thing that changes.
 *
 * Scrolling belongs to whoever owns the scroll container, not here — `Dashboard` puts
 * its content column back to the top when the address changes.
 */
import { useMemo } from 'react'
import { useRouter as useAppRouter } from 'next/navigation'

/** What a call to `push`/`replace` should actually do. */
export type Move = 'push' | 'replace' | 'stay' | 'leave'

/**
 * An address THIS app draws is root-relative. An absolute URL, a protocol-relative
 * one, or anything else is somewhere else — and going somewhere else IS a document
 * load, which is what the caller asked for.
 */
export function internal(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
}

/**
 * Decide the move, given where the app already is (`at` = path + query + fragment).
 *
 * Asking to go where you already are is not a navigation: Next's push treats it as
 * one, but a history entry that duplicates the current address makes Back do nothing
 * visible, so a `push` of the current address is `stay`. A `replace` still replaces —
 * that is how a canonical rewrite of the same screen is expressed.
 */
export function move(href: string, at: string, kind: 'push' | 'replace'): Move {
  if (!internal(href)) return 'leave'
  if (kind === 'push' && href === at) return 'stay'
  return kind
}

/** The address the browser is on, in the shape `move` compares against. */
function at(): string {
  const { pathname, search, hash } = window.location
  return `${pathname}${search}${hash}`
}

/**
 * The console's router. Same surface as Next's — the two that move the app carry the
 * address on the history API, everything else is Next's own.
 */
export function useRouter() {
  const router = useAppRouter()
  return useMemo(() => {
    const go = (href: string, kind: 'push' | 'replace') => {
      // No window means no history to push and no screen to re-render; hand it back.
      if (typeof window === 'undefined') return kind === 'push' ? router.push(href) : router.replace(href)
      switch (move(href, at(), kind)) {
        case 'leave':
          return kind === 'push' ? router.push(href) : router.replace(href)
        case 'stay':
          return
        case 'replace':
          return window.history.replaceState(null, '', href)
        case 'push':
          return window.history.pushState(null, '', href)
      }
    }
    return {
      ...router,
      push: (href: string) => go(href, 'push'),
      replace: (href: string) => go(href, 'replace'),
    }
  }, [router])
}
