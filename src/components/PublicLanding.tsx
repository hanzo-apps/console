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

import { config } from '~/config'
import { getBrand } from '~/lib/branding/brands'
import { categoriesForBrand, CATEGORY_SUMMARY } from '~/lib/products/brand-scope'
import { ConsoleFooter } from '~/components/ConsoleFooter'

export function PublicLanding() {
  const router = useRouter()
  const brand = getBrand()
  const categories = categoriesForBrand(brand.id).filter((c) => c !== 'Settings')

  return (
    <YStack minH="100vh" bg="$color1">
      {/* Top bar — brand + sign in */}
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
        <Button size="$3" onPress={() => router.push('/signin')}>
          Sign in
        </Button>
      </XStack>

      {/* Hero */}
      <YStack items="center" gap="$4" px="$4" py="$10" $md={{ py: '$12' }}>
        <YStack items="center" gap="$3" maxW={760}>
          <Text fontSize="$11" $md={{ fontSize: '$13' }} fontWeight="800" color="$color12" style={{ textAlign: 'center', lineHeight: 1.1 }}>
            The AI cloud, one platform
          </Text>
          <Text fontSize="$5" color="$color10" style={{ textAlign: 'center' }}>
            Models, compute, training, data, and the tools to ship — with usage-based billing and a single API.
          </Text>
        </YStack>
        <XStack gap="$3" mt="$2" flexWrap="wrap" justify="center">
          <Button size="$4" onPress={() => router.push('/signin')}>
            Get started
          </Button>
          <Button size="$4" chromeless onPress={() => typeof window !== 'undefined' && window.open(brand.websiteUrl, '_blank', 'noopener')}>
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
