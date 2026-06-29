'use client'

/**
 * Brand logo for the console chrome — TWO orthogonal layers:
 *   1. default: the host-derived BRAND mark (inline SVG, currentColor) + wordmark.
 *      White-label by hostname — a lux/zoo/pars host NEVER renders the Hanzo mark.
 *   2. override: the selected org's own logo (IAM `organization.logo`) when set,
 *      resolved once per org per session (cached) and failing safe to the brand
 *      mark if IAM can't be read (e.g. a non-admin session 403s the gated proxy).
 */
import { useEffect, useState } from 'react'
import { Text, XStack } from '@hanzo/gui'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { IamAdminApi } from '~/lib/api'
import { getBrand } from '~/lib/branding/brands'

/** Per-org logo cache for the session ('' = checked, none). */
const orgLogoCache = new Map<string, string>()

/** The host-derived brand mark — inline, build-time-trusted SVG (currentColor). */
function BrandMark({ size }: { size: number }) {
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

export function BrandLogo({ size = 22, wordmark = true }: { size?: number; wordmark?: boolean }) {
  const { account } = useSession()
  const orgName = account?.organization || account?.owner || config.iamOrgName
  const [logo, setLogo] = useState<string>(() => orgLogoCache.get(orgName) ?? '')

  useEffect(() => {
    if (orgLogoCache.has(orgName)) {
      setLogo(orgLogoCache.get(orgName) ?? '')
      return
    }
    let live = true
    IamAdminApi.organization(orgName)
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
  }, [orgName])

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
