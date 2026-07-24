'use client'

import { useRouter } from 'next/navigation'
import { Anchor, Text, XStack } from '@hanzo/gui'
import { config } from '~/config'
import { getBrand } from '~/lib/branding/brands'

/**
 * Console footer — a quiet, brand-aware strip at the bottom of every page's content
 * column (a Developers cluster + docs/support/legal + copyright). Brand-derived URLs
 * (getBrand) so the white-labelled consoles point at their own site, not hanzo.ai.
 * One place (DRY).
 */
export function ConsoleFooter() {
  const router = useRouter()
  const site = getBrand().websiteUrl
  const year = new Date().getFullYear()

  // Developers cluster — Docs + the API reference (brand docs site) + the in-console
  // Webhooks product (a real client route, not an external link-out).
  const devLinks = [
    { label: 'Docs', href: `${site}/docs` },
    { label: 'API', href: `${site}/docs/api` },
  ]
  const legalLinks = [
    { label: 'Support', href: `${site}/support` },
    { label: 'Privacy', href: `${site}/privacy` },
    { label: 'Terms', href: `${site}/terms` },
  ]

  const linkStyle = {
    fontSize: '$2' as const,
    color: '$color10' as const,
    hoverStyle: { color: '$color12' as const },
  }

  return (
    <XStack
      borderTopWidth={1}
      borderColor="$borderColor"
      mt="$6"
      pt="$4"
      pb="$2"
      items="center"
      justify="space-between"
      gap="$3"
      flexWrap="wrap"
    >
      <Text fontSize="$2" color="$color10">
        © {year} {config.brandName}
      </Text>
      <XStack items="center" gap="$5" flexWrap="wrap">
        {/* Developers */}
        <XStack items="center" gap="$3" flexWrap="wrap">
          <Text fontSize="$1" color="$color9" letterSpacing={0.4}>
            Developers
          </Text>
          {devLinks.map((l) => (
            <Anchor key={l.href} href={l.href} target="_blank" rel="noreferrer" {...linkStyle}>
              {l.label}
            </Anchor>
          ))}
          {/* Webhooks opens the in-console product (client route), not a new tab. */}
          <Anchor
            href="/webhooks"
            onPress={(e?: { preventDefault?: () => void }) => {
              e?.preventDefault?.()
              router.push('/webhooks')
            }}
            {...linkStyle}
          >
            Webhooks
          </Anchor>
        </XStack>
        {/* Support / legal */}
        <XStack items="center" gap="$4" flexWrap="wrap">
          {legalLinks.map((l) => (
            <Anchor key={l.href} href={l.href} target="_blank" rel="noreferrer" {...linkStyle}>
              {l.label}
            </Anchor>
          ))}
        </XStack>
      </XStack>
    </XStack>
  )
}
