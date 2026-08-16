'use client'

import { useRouter } from '~/lib/router'
import { Anchor, Text, XStack } from '@hanzo/gui'
import { config } from '~/config'
import { getBrand } from '~/lib/branding/brands'

/**
 * Console footer — a quiet, brand-aware strip at the bottom of every page's content
 * column (a Developers cluster + docs/support/legal + copyright). Brand-derived URLs
 * (getBrand) so the white-labelled consoles point at their own site, not hanzo.ai.
 * One place (DRY).
 */
const SHRINK = { flexShrink: 1 } as const

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
    // Anchor underlines by default; nothing else on any Hanzo surface does.
    textDecorationLine: 'none' as const,
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
      {/*
        Every wrapping row here needs SHRINK — a View is `flex-shrink: 0` by
        default, so these clusters held their max-content width, flex-wrap never
        engaged, and on a 390px phone the last legal link (Terms) sat past the
        right edge of a document that cannot scroll to reach it.
      */}
      <XStack items="center" gap="$5" flexWrap="wrap" style={SHRINK}>
        {/* Developers */}
        <XStack items="center" gap="$3" flexWrap="wrap" style={SHRINK}>
          {/*
            $color9 lands at 4.49:1 on the light canvas — under the 4.5 floor, so a
            cluster label was the one unreadable thing on the strip. It stays quieter
            than the links it labels by SIZE and tracking, never by a colour that fails.
          */}
          <Text fontSize="$1" color="$color10" letterSpacing={0.4}>
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
        <XStack items="center" gap="$4" flexWrap="wrap" style={SHRINK}>
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
