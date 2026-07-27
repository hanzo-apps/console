'use client'

/**
 * The two identity layers of the console chrome, kept orthogonal:
 *   1. BRAND — the host-derived mark (inline SVG, currentColor). White-label by
 *      hostname: a lux/zoo/pars host NEVER renders the Hanzo mark. This is the
 *      PRODUCT's identity (the assistant glyph, the org picker, onboarding).
 *   2. ORG — the tenant the console is scoped to: its own logo when IAM carries
 *      one, else its monogram (`OrgMark`, @hanzo/ui). This is what leads the
 *      chrome, so a customer's console shows the CUSTOMER's identity.
 *
 * The org is resolved once per org per session (cached). A tenant reads its OWN
 * org via the org-scoped `/org/iam` proxy (any member may); a global admin reads
 * via the cross-tenant `/admin/iam` proxy — so a tenant never fires the
 * admin-gated `get-organization` that would only 403. Either way it fails safe to
 * the org's name, which always resolves, so the mark is never empty.
 */
import { useEffect, useState } from 'react'
import type { Org } from '@hanzo/ui/product'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { IamAdminApi, TeamApi } from '~/lib/api'
import { getBrand } from '~/lib/branding/brands'

/** Per-org identity cache for the session (present = resolved, logo may be ''). */
const orgCache = new Map<string, Org>()

/** The host-derived brand mark — inline, build-time-trusted SVG (currentColor).
 *  White-label by hostname: a lux/zoo/pars host renders ITS mark, never Hanzo's.
 *  Exported so surfaces that need JUST the brand H (sidebar fallback, support
 *  bubble) share the one definition. */
export function BrandMark({ size }: { size: number }) {
  const brand = getBrand()
  return (
    <svg
      width={size}
      height={size}
      viewBox={brand.logoViewBox}
      role="img"
      aria-label={brand.brandName}
      fill="currentColor"
      style={{ display: 'block', flexShrink: 0 }}
      // logoContent is a hardcoded constant in src/lib/branding/brands.ts — never
      // user input — so inlining it as SVG markup is safe.
      dangerouslySetInnerHTML={{ __html: brand.logoContent }}
    />
  )
}

/** The current org name the console is scoped to (org > owner > brand default). */
export function useOrgName(): string {
  const { account } = useSession()
  return account?.organization || account?.owner || config.iamOrgName
}

/**
 * The org the console is scoped to, as `OrgMark` wants it — name, display name
 * and logo, resolved once per org per session. The ONE org-identity source in the
 * console: the top-left mark and anything else that shows the tenant read this,
 * so one fetch serves them all and they can never disagree.
 *
 * It resolves synchronously to the org's name, so the mark paints its monogram
 * immediately and only sharpens into the logo/display name when IAM answers —
 * there is no empty frame, and a 403/404 simply leaves the monogram standing.
 */
export function useOrgIdentity(): Org {
  const isSuperAdmin = useIsSuperAdmin()
  const orgName = useOrgName()
  const [org, setOrg] = useState<Org>(() => orgCache.get(orgName) ?? { name: orgName })

  useEffect(() => {
    const cached = orgCache.get(orgName)
    if (cached) {
      setOrg(cached)
      return
    }
    setOrg({ name: orgName })
    let live = true
    // A global admin reads any org via the cross-tenant `/admin/iam` proxy; a tenant
    // reads its OWN org via the org-scoped `/org/iam` proxy (which authorizes any
    // member). This keeps the tenant's own-org identity working without firing the
    // admin-gated `get-organization` that would only 403 in the browser console.
    const fetchOrg = isSuperAdmin ? IamAdminApi.organization(orgName) : TeamApi.organization(orgName)
    fetchOrg
      .then((o) => {
        const resolved: Org = {
          name: orgName,
          displayName: typeof o.displayName === 'string' && o.displayName.trim() ? o.displayName : undefined,
          logo: typeof o.logo === 'string' && o.logo ? o.logo : undefined,
        }
        orgCache.set(orgName, resolved)
        if (live) setOrg(resolved)
      })
      .catch(() => {
        const bare: Org = { name: orgName }
        orgCache.set(orgName, bare)
        if (live) setOrg(bare)
      })
    return () => {
      live = false
    }
  }, [orgName, isSuperAdmin])

  return org
}
