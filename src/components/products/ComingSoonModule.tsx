'use client'

/**
 * Coming-soon / waitlist placeholder for a cloud product whose full admin module
 * isn't built yet. Every Hanzo cloud product is registered in the product menu —
 * the ones without a finished console surface render this, so we can track
 * enablement status (soon vs waitlist) for the whole catalog in one place.
 *
 * `comingSoon()` is a factory: it captures a product's label/repo/blurb/status and
 * returns a route component (the registry's routes take `ComponentType`, so a
 * per-product closure is the clean way to parameterize without a shell edit).
 */
import { Button, Text, XStack, YStack } from '@hanzo/gui'

/** Enablement state for a product module, surfaced in the nav + landing. */
export type ProductStatus = 'enabled' | 'soon' | 'waitlist'

export function comingSoon(opts: {
  /** Product display name, e.g. 'Hanzo Vector'. */
  label: string
  /** Source repo, e.g. 'hanzoai/vector'. */
  repo: string
  /** One-paragraph positioning. */
  blurb: string
  /** 'soon' = built, not yet enabled here; 'waitlist' = gauging demand. */
  status: Exclude<ProductStatus, 'enabled'>
}) {
  return function ComingSoonModule() {
    const isWaitlist = opts.status === 'waitlist'
    const repoUrl = `https://github.com/${opts.repo}`
    return (
      <YStack p="$6" gap="$4" maxW={720}>
        <XStack items="center" gap="$3">
          <Text fontWeight="800" fontSize="$8">
            {opts.label}
          </Text>
          <YStack
            px="$2.5"
            py="$1"
            rounded="$10"
            bg={isWaitlist ? '$yellow5' : '$blue5'}
          >
            <Text fontSize="$1" fontWeight="800" letterSpacing={1}>
              {isWaitlist ? 'WAITLIST' : 'COMING SOON'}
            </Text>
          </YStack>
        </XStack>

        <Text color="$color11" fontSize="$5">
          {opts.blurb}
        </Text>

        <Text color="$color10" fontSize="$3">
          source · github.com/{opts.repo}
        </Text>

        <XStack gap="$3" pt="$2">
          <Button
            theme="blue"
            onPress={() => {
              if (typeof window !== 'undefined') window.open(repoUrl, '_blank', 'noopener')
            }}
          >
            View repo
          </Button>
          {isWaitlist && (
            <Button
              onPress={() => {
                if (typeof window !== 'undefined')
                  window.open('https://hanzo.ai/cloud', '_blank', 'noopener')
              }}
            >
              Join the waitlist
            </Button>
          )}
        </XStack>
      </YStack>
    )
  }
}
