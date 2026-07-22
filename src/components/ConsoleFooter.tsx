'use client'

import { Anchor, Text, XStack } from '@hanzo/gui'
import { config } from '~/config'
import { getBrand } from '~/lib/branding/brands'

/**
 * Console footer — a quiet, brand-aware strip at the bottom of every page's content
 * column (docs / support / legal + copyright). Brand-derived URLs (getBrand) so the
 * white-labelled consoles point at their own site, not hanzo.ai. One place (DRY).
 */
export function ConsoleFooter() {
  const site = getBrand().websiteUrl
  const year = new Date().getFullYear()
  const links = [
    { label: 'Docs', href: `${site}/docs` },
    { label: 'Support', href: `${site}/support` },
    { label: 'Privacy', href: `${site}/privacy` },
    { label: 'Terms', href: `${site}/terms` },
  ]
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
      <XStack items="center" gap="$4" flexWrap="wrap">
        {links.map((l) => (
          <Anchor
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            fontSize="$2"
            color="$color10"
            hoverStyle={{ color: '$color12' }}
          >
            {l.label}
          </Anchor>
        ))}
      </XStack>
    </XStack>
  )
}
