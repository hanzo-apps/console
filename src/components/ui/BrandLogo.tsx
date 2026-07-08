'use client'

/**
 * Brand logo for the console chrome — TWO orthogonal layers:
 *   1. default: the host-derived BRAND mark (inline SVG, currentColor) + wordmark.
 *      White-label by hostname — a lux/zoo/pars host NEVER renders the Hanzo mark.
 *   2. override: the selected org's own logo (IAM `organization.logo`) when set,
 *      resolved once per org per session (cached). A tenant reads its OWN org via
 *      the org-scoped `/org/iam` proxy (any member may); a global admin reads via
 *      the cross-tenant `/admin/iam` proxy — so a tenant never fires the admin-gated
 *      `get-organization` that only 403s. Either way it fails safe to the brand mark.
 */
import { useEffect, useState } from 'react'
import { Text, XStack } from '@hanzo/gui'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { IamAdminApi, TeamApi } from '~/lib/api'
import { getBrand } from '~/lib/branding/brands'

/** Per-org logo cache for the session ('' = checked, none). */
const orgLogoCache = new Map<string, string>()

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
 * The selected org's own logo URL (IAM `organization.logo`), or '' when none —
 * the ONE org-logo source (cached per session). Reused by `BrandLogo` and the
 * sidebar org-brand header so the fetch happens once and both stay in lockstep.
 */
export function useOrgLogo(): string {
  const isSuperAdmin = useIsSuperAdmin()
  const orgName = useOrgName()
  const [logo, setLogo] = useState<string>(() => orgLogoCache.get(orgName) ?? '')

  useEffect(() => {
    if (orgLogoCache.has(orgName)) {
      setLogo(orgLogoCache.get(orgName) ?? '')
      return
    }
    let live = true
    // A global admin reads any org via the cross-tenant `/admin/iam` proxy; a tenant
    // reads its OWN org via the org-scoped `/org/iam` proxy (which authorizes any
    // member). This keeps the tenant's own-org logo working without firing the
    // admin-gated `get-organization` that would only 403 in the browser console.
    const fetchOrg = isSuperAdmin ? IamAdminApi.organization(orgName) : TeamApi.organization(orgName)
    fetchOrg
      .then((o) => {
        const l = typeof o.logo === 'string' ? o.logo : ''
        orgLogoCache.set(orgName, l)
        if (live) setLogo(l)
      })
      .catch(() => {
        orgLogoCache.set(orgName, '')
        if (live) setLogo('')
      })
    return () => {
      live = false
    }
  }, [orgName, isSuperAdmin])

  return logo
}

export function BrandLogo({ size = 22, wordmark = true }: { size?: number; wordmark?: boolean }) {
  const logo = useOrgLogo()

  const wordmarkText = `${getBrand().brandName.replace(' Cloud', '')} Console`

  return (
    <XStack items="center" gap="$2">
      {logo ? (
        // Arbitrary external org logo URL — raw <img> (next/image would need a
        // configured remote allowlist for every tenant domain).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt="Organization logo"
          style={{ height: size, width: 'auto', maxWidth: size * 5, objectFit: 'contain', display: 'block' }}
        />
      ) : (
        <BrandMark size={size} />
      )}
      {wordmark ? (
        <Text fontWeight="800" fontSize="$5" color="$color12">
          {wordmarkText}
        </Text>
      ) : null}
    </XStack>
  )
}
