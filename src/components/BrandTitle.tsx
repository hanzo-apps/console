'use client'

import { useEffect } from 'react'

import { branding } from '~/config'

/**
 * BrandTitle — keep the browser-tab document.title white-labeled to the request
 * host's brand, on the client.
 *
 * The console ships into the unified `hanzoai/cloud` binary as a Next.js STATIC
 * EXPORT (go:embed): `generateMetadata` runs at BUILD time with the default host,
 * so the exported <title> is baked to "Hanzo Cloud Console" for every host. The
 * cloud serving layer rewrites that <title> per Host on the first paint, but Next
 * re-applies the baked metadata title on hydration (and on client navigations) —
 * reverting a Lux/Zoo tab back to "Hanzo Cloud Console", a white-label violation.
 *
 * This client net resolves the brand from window.location (via `branding.name`,
 * the same source the visible shell uses) and enforces the correct title,
 * defeating the baked-metadata re-application. On the dynamic standalone app the
 * SSR title is already host-correct, so this only ever re-affirms it — a no-op.
 */
export function BrandTitle() {
  useEffect(() => {
    const desired = branding.name // "<Brand> Cloud Console", from window.location
    const apply = () => {
      if (document.title !== desired) document.title = desired
    }
    apply()
    // Next re-applies the baked metadata title after hydration; re-affirm the
    // brand title whenever the document head mutates. Writing document.title only
    // when it has drifted keeps the observer from looping on its own change.
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])

  return null
}
