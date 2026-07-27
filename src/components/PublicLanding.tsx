'use client'

/**
 * PublicLanding — what an UNAUTHENTICATED visitor sees at `/` (the marketing face
 * of the console). The SAME one `cloud` binary that serves the signed-in console
 * serves this to anon — one binary, one way, no separate marketing service.
 *
 * Content is DERIVED from the real product taxonomy (categoriesForBrand +
 * CATEGORY_SUMMARY), brand-scoped via getBrand — so it is honest (every tile is a
 * real category the platform ships) and white-labels for free. The primary CTA is
 * the ONE sign-in surface (/signin); "Learn more" goes to the brand's own site.
 */
import { useRouter } from 'next/navigation'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { HanzoHeader, HANZO_PRODUCT_CATEGORIES, findSurfaceByHost, type HanzoSurface } from '@hanzogui/shell'

import { config } from '~/config'
import { getBrand } from '~/lib/branding/brands'
import { categoriesForBrand, CATEGORY_SUMMARY } from '~/lib/products/brand-scope'
import { landingSurface } from '~/lib/products/landing-surface'
import { ConsoleFooter } from '~/components/ConsoleFooter'

/** The shared header, with its CTAs re-pointed at this landing's own sign-in
 *  (the canonical surface aims them AT the console — a self-link from here). */
const LANDING_SURFACE: HanzoSurface = landingSurface(findSurfaceByHost('cloud.hanzo.ai'))

/**
 * Decline the shell's account control. `HanzoHeader` renders its OWN text "Sign in"
 * link whenever `account` is nullish (`account ?? <DefaultAccount/>`), so omitting it
 * put a second sign-in beside the primary CTA that IS the sign-in — the desktop
 * logged-out header read `[Get API key] [Sign in] [Sign in]`. `false` is how a caller
 * says "no account node": it is not nullish, so the default never renders, and React
 * renders nothing for it — including in the mobile sheet, which would otherwise draw
 * an empty bordered identity row around it. Exactly ONE sign-in affordance.
 */
const NO_ACCOUNT = false

/**
 * The house hero buttons — the same pill pair every Hanzo landing wears: a white
 * primary carrying the weight, and a hairline secondary that is still visibly a
 * button. Tamagui's default Button is a grey chip that reads as DISABLED next to
 * the white sign-in pill in the header, and `chromeless` has no edge at all.
 */
const CTA_PRIMARY = {
  rounded: 999,
  bg: '$color12',
  color: '$color1',
  borderWidth: 0,
  hoverStyle: { bg: '$color12', opacity: 0.85 },
  pressStyle: { bg: '$color12', opacity: 0.7 },
} as const

const CTA_SECONDARY = {
  rounded: 999,
  bg: 'transparent',
  color: '$color12',
  borderWidth: 1,
  borderColor: '$color6',
  hoverStyle: { bg: '$color3', borderColor: '$color8' },
  pressStyle: { bg: '$color4' },
} as const

export function PublicLanding() {
  const router = useRouter()
  const brand = getBrand()
  const categories = categoriesForBrand(brand.id).filter((c) => c !== 'Settings')

  const signIn = (
    <Button size="$3" onPress={() => router.push('/signin')}>
      Sign in
    </Button>
  )

  return (
    <YStack minH="100vh" bg="$color1">
      {/*
        Top bar. On the Hanzo brand this is the UNIFIED @hanzogui/shell HanzoHeader
        (Meet Hanzo + the rich ten-category Products mega-menu + brand tokens) — the
        SAME header every Hanzo surface wears. White-label brands (lux/zoo/…) keep the
        brand-neutral bar so no Hanzo ecosystem URL leaks onto their console.
      */}
      {brand.id === 'hanzo' ? (
        // The header's own primary CTA IS the sign-in (see LANDING_SURFACE), so the
        // account control is declined explicitly (see NO_ACCOUNT) — one way in, not
        // two competing sign-ins.
        <HanzoHeader
          surface={LANDING_SURFACE}
          productsTaxonomy={HANZO_PRODUCT_CATEGORIES}
          account={NO_ACCOUNT}
        />
      ) : (
        <XStack
          items="center"
          justify="space-between"
          px="$4"
          py="$3"
          borderBottomWidth={1}
          borderColor="$borderColor"
          $md={{ px: '$6' }}
        >
          <Text fontSize="$6" fontWeight="700" color="$color12">
            {config.brandName}
          </Text>
          {signIn}
        </XStack>
      )}

      {/* Hero */}
      <YStack items="center" gap="$4" px="$4" py="$10" $md={{ py: '$12' }}>
        <YStack items="center" gap="$3" maxW={760}>
          {/* `hz-display` gives the headline a unitless line-height (see globals.css):
              the size token's own line-height is tuned for ONE line, so on a phone —
              where this always wraps — the two lines overprint without it. */}
          <Text
            render="h1"
            className="hz-display"
            fontSize="$11"
            $md={{ fontSize: '$13' }}
            fontWeight="800"
            color="$color12"
            style={{ textAlign: 'center' }}
          >
            The AI cloud, one platform
          </Text>
          <Text fontSize="$5" color="$color10" style={{ textAlign: 'center' }}>
            Models, compute, training, data, and the tools to ship — with usage-based billing and a single API.
          </Text>
        </YStack>
        <XStack gap="$3" mt="$2" flexWrap="wrap" justify="center">
          <Button
            size="$4"
            {...CTA_PRIMARY}
            onPress={() => router.push('/signin')}
          >
            Get started
          </Button>
          <Button
            size="$4"
            {...CTA_SECONDARY}
            onPress={() => typeof window !== 'undefined' && window.open(brand.websiteUrl, '_blank', 'noopener')}
          >
            Learn more
          </Button>
        </XStack>
      </YStack>

      {/* Real product categories — derived from the live taxonomy */}
      <XStack justify="center" px="$4" pb="$10" $md={{ px: '$6' }}>
        <YStack width="100%" maxW={1080} gap="$4">
          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            }}
          >
            {categories.map((c) => (
              <YStack
                key={c}
                gap="$1.5"
                p="$4"
                rounded="$4"
                borderWidth={1}
                borderColor="$borderColor"
                bg="$color2"
              >
                <Text fontSize="$5" fontWeight="700" color="$color12">
                  {c}
                </Text>
                <Text fontSize="$3" color="$color10">
                  {CATEGORY_SUMMARY[c]}
                </Text>
              </YStack>
            ))}
          </div>
        </YStack>
      </XStack>

      <XStack justify="center" px="$4" $md={{ px: '$6' }}>
        <YStack width="100%" maxW={1080}>
          <ConsoleFooter />
        </YStack>
      </XStack>
    </YStack>
  )
}
