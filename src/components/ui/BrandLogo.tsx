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
import { BrandMark as Mark, type Org } from '@hanzo/ui/product'
import { getAnimatedSVG as hanzoMotion } from '@hanzo/logo'
import { getAnimatedSVG as luxMotion } from '@luxfi/logo'
import { getAnimatedSVG as zooMotion } from '@zooai/logo'

import { config, type BrandId } from '~/config'
import { useSession } from '~/lib/auth/session'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { IamAdminApi, TeamApi } from '~/lib/api'

/** Per-org identity cache for the session (present = resolved, logo may be ''). */
const orgCache = new Map<string, Org>()

/** Each brand's own published animated mark (load → hover → press, pure CSS).
 *  Motion ships per brand, so it is the APP that holds these — a design system
 *  carrying all of them would put every brand's bytes in every brand's page. */
const MOTION: Partial<Record<BrandId, () => string>> = {
  hanzo: hanzoMotion,
  lux: luxMotion,
  zoo: zooMotion,
}

/**
 * This surface's brand mark — geometry from @hanzo/ui, motion from the brand's
 * own package. White-label by host: a lux/zoo/pars console renders ITS mark.
 *
 * It used to resolve the registry itself, in two files. @hanzo/ui 8.0.98 does
 * that resolution for every brand, so what is left here is the binding: which
 * brand this console is, and which motion packages it carries.
 *
 * The static mark renders on the server and on first paint (no hydration
 * mismatch), then upgrades to the animated one on mount.
 */
export function BrandMark({ size, animated = true }: { size: number; animated?: boolean }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const motion = animated && mounted ? MOTION[config.brand] : undefined
  return <Mark brand={config.brand} size={size} wordmark={false} animated={motion ?? false} />
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
