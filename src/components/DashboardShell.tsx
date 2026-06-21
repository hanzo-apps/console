'use client'

/**
 * Dashboard shell — sidebar nav + top bar + content slot.
 *
 * Adapted from the @hanzo/gui `dashboard-shell` recipe; nav items are driven by
 * the product-module registry, and the active item is derived from the current
 * route. Branding and sign-out live in the top bar. Style props use the v5
 * shorthand set.
 */
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { LogOut } from '@hanzogui/lucide-icons-2'

import { branding } from '~/config'
import { productModules } from '~/lib/products/registry'
import { useSession } from '~/lib/auth/session'

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { account, signOut } = useSession()

  const activeId = productModules.find((m) => pathname.startsWith(`/${m.id}`))?.id

  return (
    <XStack flex={1} minH="100vh" bg="$background">
      <YStack
        width={248}
        p="$3"
        gap="$1"
        borderRightWidth={1}
        borderColor="$borderColor"
        bg="$color1"
      >
        <XStack py="$3" px="$2" items="center" gap="$2">
          <Text fontWeight="800" fontSize="$5">
            {branding.name}
          </Text>
        </XStack>

        <ScrollView flex={1}>
          <YStack gap="$1">
            {productModules.map((m) => {
              const Icon = m.icon
              const active = m.id === activeId
              return (
                <Button
                  key={m.id}
                  onPress={() => router.push(`/${m.id}`)}
                  bg={active ? '$color5' : 'transparent'}
                  justify="flex-start"
                  icon={<Icon size={18} />}
                  size="$3"
                >
                  {m.label}
                </Button>
              )
            })}
          </YStack>
        </ScrollView>
      </YStack>

      <YStack flex={1}>
        <XStack
          height={56}
          px="$4"
          items="center"
          justify="flex-end"
          gap="$3"
          borderBottomWidth={1}
          borderColor="$borderColor"
        >
          {account ? (
            <Text color="$color11" fontSize="$3">
              {account.displayName || account.name}
            </Text>
          ) : null}
          <Button size="$2" chromeless icon={<LogOut size={16} />} onPress={() => void signOut()}>
            Sign out
          </Button>
        </XStack>

        <ScrollView flex={1}>
          <YStack flex={1} p="$4" gap="$4">
            {children}
          </YStack>
        </ScrollView>
      </YStack>
    </XStack>
  )
}
