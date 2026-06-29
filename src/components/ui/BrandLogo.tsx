'use client'

/**
 * Brand logo for the console chrome — the selected org's logo when it has one
 * (IAM `organization.logo`), otherwise the Hanzo "H" mark. Resolved once per org
 * per session (cached) and fails safe to the H mark if IAM can't be read.
 */
import { useEffect, useState } from 'react'
import { Text, XStack } from '@hanzo/gui'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { IamAdminApi } from '~/lib/api'
import { HanzoMark } from './HanzoMark'

/** Per-org logo cache for the session ('' = checked, none). */
const orgLogoCache = new Map<string, string>()

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
        <HanzoMark size={size} />
      )}
      {wordmark ? (
        <Text fontWeight="800" fontSize="$5" color="$color12">
          Console
        </Text>
      ) : null}
    </XStack>
  )
}
