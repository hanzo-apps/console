'use client'

/**
 * Dashboard shell — sidebar (Pinned + categorized catalog) + top bar + content.
 *
 * The sidebar renders entirely from the product catalog: a Pinned section the
 * user curates (favorites), then every product grouped by category. Each row
 * opens the product (in-console route or external tab) and carries a pin
 * toggle. Active state is an EXACT match so e.g. `stores` never lights up while
 * a sibling is open. Adding a product to the catalog makes it appear here with
 * no shell edits.
 */
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { LogOut, Star, Lock, ExternalLink, LayoutGrid } from '@hanzogui/lucide-icons-2'

import { branding } from '~/config'
import { catalogByCategory, findEntry, type CatalogEntry } from '~/lib/products/registry'
import { openProduct } from '~/lib/products/open'
import { useFavorites } from '~/lib/products/favorites'
import { useSession } from '~/lib/auth/session'

function NavRow({
  entry,
  active,
  pinned,
  onOpen,
  onToggle,
}: {
  entry: CatalogEntry
  active: boolean
  pinned: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  const Icon = entry.icon
  const hint = entry.admin ? (
    <Lock size={12} opacity={0.45} />
  ) : entry.kind === 'external' ? (
    <ExternalLink size={12} opacity={0.4} />
  ) : undefined
  return (
    <XStack items="center" gap="$1">
      <Button
        flex={1}
        onPress={onOpen}
        bg={active ? '$color5' : 'transparent'}
        justify="flex-start"
        icon={<Icon size={18} />}
        iconAfter={hint}
        size="$3"
      >
        {entry.label}
      </Button>
      <Button
        size="$2"
        chromeless
        opacity={pinned ? 1 : 0.3}
        icon={<Star size={15} />}
        onPress={onToggle}
        aria-label={pinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
      />
    </XStack>
  )
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { account, signOut } = useSession()
  const { pinned, toggle, isPinned } = useFavorites()

  const push = (path: string) => router.push(path)
  const isActive = (id: string) => pathname === `/${id}` || pathname.startsWith(`/${id}/`)

  const pinnedEntries = pinned
    .map((id) => findEntry(id))
    .filter((e): e is CatalogEntry => Boolean(e))

  const groups = catalogByCategory()

  return (
    <XStack flex={1} minH="100vh" bg="$background">
      <YStack
        width={264}
        p="$3"
        gap="$2"
        borderRightWidth={1}
        borderColor="$borderColor"
        bg="$color1"
      >
        <Button
          onPress={() => push('/')}
          bg={pathname === '/' ? '$color5' : 'transparent'}
          justify="flex-start"
          icon={<LayoutGrid size={18} />}
          size="$3"
          mb="$1"
        >
          <Text fontWeight="800" fontSize="$5">
            {branding.name}
          </Text>
        </Button>

        <ScrollView flex={1}>
          <YStack gap="$3">
            {pinnedEntries.length > 0 ? (
              <YStack gap="$1">
                <Text px="$2" fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
                  Pinned
                </Text>
                {pinnedEntries.map((entry) => (
                  <NavRow
                    key={`pin-${entry.id}`}
                    entry={entry}
                    active={entry.kind === 'module' && isActive(entry.id)}
                    pinned
                    onOpen={() => openProduct(entry, push)}
                    onToggle={() => toggle(entry.id)}
                  />
                ))}
              </YStack>
            ) : null}

            {groups.map((group) => (
              <YStack key={group.category} gap="$1">
                <Text px="$2" fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
                  {group.category}
                </Text>
                {group.entries.map((entry) => (
                  <NavRow
                    key={entry.id}
                    entry={entry}
                    active={entry.kind === 'module' && isActive(entry.id)}
                    pinned={isPinned(entry.id)}
                    onOpen={() => openProduct(entry, push)}
                    onToggle={() => toggle(entry.id)}
                  />
                ))}
              </YStack>
            ))}
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
