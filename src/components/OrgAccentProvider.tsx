'use client'

/**
 * Org accent applier — reads the signed-in org's persisted brand color and applies it
 * to the live console accent on EVERY load (so a custom theme survives reload), and
 * clears it on sign-out. This is the load-time half of the "apply the org's theme
 * color" fix; Settings → Branding applies it immediately on save via the same
 * `applyOrgAccent`, so the two share one mechanism.
 *
 * It fetches the active org's `themeData` (`TeamApi.organization`, the org-scoped IAM
 * read an org admin can make) once the session resolves, then applies. Best-effort: a
 * failed fetch simply leaves the default monochrome accent (never throws, never blocks
 * render). Renders nothing.
 */
import { useEffect } from 'react'

import { TeamApi } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { useSession } from '~/lib/auth/session'
import { setOrgAccent } from '@hanzo/ui/product'

export function OrgAccentProvider() {
  const { account } = useSession()
  // Re-resolve when the signed-in identity changes (sign-in / sign-out / org switch,
  // which reloads with a new `currentOrg()`).
  const owner = account?.owner ?? null

  useEffect(() => {
    if (!owner) {
      setOrgAccent(null) // signed out → default monochrome accent
      return
    }
    let cancelled = false
    TeamApi.organization(currentOrg())
      .then((org) => {
        if (!cancelled) setOrgAccent(org.themeData)
      })
      .catch(() => {
        // Org theme unreadable on this host → keep the default accent (no fabrication).
        if (!cancelled) setOrgAccent(null)
      })
    return () => {
      cancelled = true
    }
  }, [owner])

  return null
}
