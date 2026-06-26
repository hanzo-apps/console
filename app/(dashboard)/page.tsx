'use client'

import { useRouter } from 'next/navigation'
import { Card, Text, XStack, YStack } from '@hanzo/gui'

import { branding } from '~/config'
import { productModules } from '~/lib/products/registry'
import { PageHeader } from '~/components/ui/PageHeader'

export default function DashboardHome() {
  const router = useRouter()
  return (
    <>
      <PageHeader title={branding.name} subtitle="Manage Hanzo Cloud and all cloud products." />
      <XStack flexWrap="wrap" gap="$3">
        {productModules.map((m) => {
          const Icon = m.icon
          return (
            <Card
              key={m.id}
              borderWidth={1}
              borderColor="$borderColor"
              p="$4"
              gap="$2"
              width={260}
              hoverStyle={{ bg: '$color2' }}
              cursor="pointer"
              onPress={() => router.push(`/${m.id}`)}
            >
              <XStack gap="$2" items="center">
                <Icon size={20} />
                <Text fontSize="$5" fontWeight="700">
                  {m.label}
                </Text>
                {m.status && m.status !== 'enabled' && (
                  <YStack
                    px="$2"
                    py={1}
                    rounded="$10"
                    bg={m.status === 'waitlist' ? '$yellow5' : '$blue5'}
                  >
                    <Text fontSize={9} fontWeight="800" letterSpacing={0.5}>
                      {m.status === 'waitlist' ? 'WAITLIST' : 'SOON'}
                    </Text>
                  </YStack>
                )}
              </XStack>
              <Text fontSize="$3" color="$color11">
                {m.description}
              </Text>
            </Card>
          )
        })}
      </XStack>
    </>
  )
}
