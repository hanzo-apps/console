'use client'

/**
 * Dashboard shell — sidebar (Overview + Docs + Pinned + categorized catalog) + top
 * bar + content.
 *
 * The sidebar renders from the product catalog: fixed Overview/Docs links, a Pinned
 * section the user curates (favorites), then every product grouped by category. A
 * filter box narrows the whole sidebar so any product is one keystroke away, and
 * each catalog row carries a pin toggle. The brand "H" mark COLLAPSES/expands the
 * sidebar (icon-only ↔ full), persisted to the account so it follows the user.
 * Active state is an EXACT match so e.g. `stores` never lights up while a sibling
 * is open. Adding a product to the catalog makes it appear here with no shell edits.
 */
import { useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Input, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import {
  BookOpen,
  CircleHelp,
  ExternalLink,
  House,
  LayoutGrid,
  Lock,
  LogOut,
  PanelLeft,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { catalogByCategory, findEntry, type CatalogEntry } from '~/lib/products/registry'
import { entryMatches } from '~/lib/products/search'
import { openProduct } from '~/lib/products/open'
import { useFavorites } from '~/lib/products/favorites'
import { usePreferences } from '~/lib/products/preferences'
import { useSession } from '~/lib/auth/session'
import { CommandSearchBox } from '~/components/CommandPalette'
import { useAppLauncher } from '~/components/AppLauncher'
import { ThemeToggle } from '~/components/ui/ThemeToggle'
import { Breadcrumbs } from '~/components/ui/Breadcrumbs'
import { BrandLogo } from '~/components/ui/BrandLogo'
import { OrgSwitcher } from '~/components/OrgSwitcher'
import { ScopeSwitcher } from '~/components/ScopeSwitcher'

const EXPANDED_W = 264
const COLLAPSED_W = 64

/** A fixed (non-catalog) sidebar link: Overview, Docs. */
function FixedRow({
  icon: Icon,
  label,
  active,
  external,
  collapsed,
  onPress,
}: {
  icon: ComponentType<{ size?: number }>
  label: string
  active?: boolean
  external?: boolean
  collapsed: boolean
  onPress: () => void
}) {
  return (
    <Button
      onPress={onPress}
      bg={active ? '$color5' : 'transparent'}
      justify={collapsed ? 'center' : 'flex-start'}
      icon={<Icon size={18} />}
      iconAfter={!collapsed && external ? <ExternalLink size={12} opacity={0.4} /> : undefined}
      size="$3"
      aria-label={label}
    >
      {collapsed ? undefined : label}
    </Button>
  )
}

function NavRow({
  entry,
  active,
  pinned,
  collapsed,
  onOpen,
  onToggle,
}: {
  entry: CatalogEntry
  active: boolean
  pinned: boolean
  collapsed: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  const Icon = entry.icon
  if (collapsed) {
    return (
      <Button
        onPress={onOpen}
        bg={active ? '$color5' : 'transparent'}
        justify="center"
        icon={<Icon size={18} />}
        size="$3"
        aria-label={entry.label}
      />
    )
  }
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
      {entry.status === 'soon' && (
        <YStack px="$1.5" py={1} rounded="$10" bg="$color4">
          <Text fontSize={9} fontWeight="800" letterSpacing={0.5}>
            SOON
          </Text>
        </YStack>
      )}
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
  const { get, set } = usePreferences()
  const launcher = useAppLauncher()
  const [filter, setFilter] = useState('')

  const collapsed = get<boolean>('sidebarCollapsed', false)
  const toggleCollapsed = () => set('sidebarCollapsed', !collapsed)

  const push = (path: string) => router.push(path)
  const isActive = (id: string) => pathname === `/${id}` || pathname.startsWith(`/${id}/`)
  const openDocs = () => {
    if (typeof window !== 'undefined') window.open(config.docsUrl, '_blank', 'noopener')
  }

  // When collapsed the filter box is hidden, so it never silently hides icons.
  const q = (collapsed ? '' : filter).trim().toLowerCase()
  const filtering = q.length > 0

  const pinnedEntries = pinned
    .map((id) => findEntry(id))
    .filter((e): e is CatalogEntry => Boolean(e))

  const groups = useMemo(
    () =>
      catalogByCategory()
        .map((g) => ({ category: g.category, entries: g.entries.filter((e) => entryMatches(e, q)) }))
        .filter((g) => g.entries.length > 0),
    [q],
  )

  return (
    <XStack flex={1} minH="100vh" bg="$background">
      <YStack
        width={collapsed ? COLLAPSED_W : EXPANDED_W}
        p="$3"
        gap="$2"
        borderRightWidth={1}
        borderColor="$borderColor"
        bg="$color1"
      >
        {/* Header: the H mark toggles collapse; the grid opens the app launcher. */}
        {collapsed ? (
          <YStack items="center" gap="$2" mb="$1">
            <Button
              size="$3"
              chromeless
              onPress={toggleCollapsed}
              icon={<BrandLogo size={22} wordmark={false} />}
              aria-label="Expand sidebar"
            />
            <Button
              size="$3"
              chromeless
              icon={<LayoutGrid size={18} />}
              onPress={launcher.open}
              aria-label="All apps"
            />
          </YStack>
        ) : (
          <XStack items="center" gap="$1" mb="$1">
            <Button
              flex={1}
              onPress={toggleCollapsed}
              bg="transparent"
              justify="flex-start"
              iconAfter={<PanelLeft size={15} opacity={0.4} />}
              size="$3"
              aria-label="Collapse sidebar"
            >
              <BrandLogo size={22} />
            </Button>
            <Button
              size="$3"
              chromeless
              icon={<LayoutGrid size={18} />}
              onPress={launcher.open}
              aria-label="All apps"
            />
          </XStack>
        )}

        {/* Filter box — narrows the whole sidebar to find any product fast. */}
        {!collapsed ? (
          <XStack
            items="center"
            gap="$2"
            px="$2.5"
            height={34}
            rounded="$3"
            borderWidth={1}
            borderColor="$borderColor"
            bg="$color2"
          >
            <Search size={14} opacity={0.6} />
            <Input
              flex={1}
              unstyled
              value={filter}
              onChangeText={setFilter}
              placeholder="Filter products…"
              fontSize="$3"
              color="$color12"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {filter ? (
              <Button size="$1" chromeless icon={<X size={13} />} onPress={() => setFilter('')} aria-label="Clear filter" />
            ) : null}
          </XStack>
        ) : null}

        <ScrollView flex={1}>
          <YStack gap="$3">
            {/* Fixed links — hidden while filtering so results stay focused. */}
            {!filtering ? (
              <YStack gap="$1">
                <FixedRow
                  icon={House}
                  label="Overview"
                  active={pathname === '/'}
                  collapsed={collapsed}
                  onPress={() => push('/')}
                />
                <FixedRow icon={BookOpen} label="Docs" external collapsed={collapsed} onPress={openDocs} />
              </YStack>
            ) : null}

            {!filtering && pinnedEntries.length > 0 ? (
              <YStack gap="$1">
                {!collapsed ? (
                  <Text px="$2" fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
                    Pinned
                  </Text>
                ) : null}
                {pinnedEntries.map((entry) => (
                  <NavRow
                    key={`pin-${entry.id}`}
                    entry={entry}
                    active={entry.kind === 'module' && isActive(entry.id)}
                    pinned
                    collapsed={collapsed}
                    onOpen={() => openProduct(entry, push)}
                    onToggle={() => toggle(entry.id)}
                  />
                ))}
              </YStack>
            ) : null}

            {groups.map((group) => (
              <YStack key={group.category} gap="$1">
                {!collapsed ? (
                  <Text px="$2" fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
                    {group.category}
                  </Text>
                ) : null}
                {group.entries.map((entry) => (
                  <NavRow
                    key={entry.id}
                    entry={entry}
                    active={entry.kind === 'module' && isActive(entry.id)}
                    pinned={isPinned(entry.id)}
                    collapsed={collapsed}
                    onOpen={() => openProduct(entry, push)}
                    onToggle={() => toggle(entry.id)}
                  />
                ))}
              </YStack>
            ))}

            {filtering && groups.length === 0 ? (
              <Text px="$2" py="$3" fontSize="$2" color="$color10">
                No products match “{filter.trim()}”.
              </Text>
            ) : null}
          </YStack>
        </ScrollView>

        {/* Always-visible wallet: balance + top-up, pinned bottom-left on every page. */}
        <SidebarWallet collapsed={collapsed} />
      </YStack>

      <YStack flex={1}>
        <XStack
          height={56}
          px="$4"
          items="center"
          gap="$3"
          borderBottomWidth={1}
          borderColor="$borderColor"
        >
          <CommandSearchBox />
          <Button
            size="$3"
            icon={<LayoutGrid size={18} />}
            onPress={launcher.open}
            borderWidth={1}
            borderColor="$borderColor"
          >
            Apps
          </Button>
          <XStack flex={1} />
          <XStack items="center" gap="$2">
            <ThemeToggle />
            <Button
              size="$2"
              chromeless
              icon={<CircleHelp size={16} />}
              onPress={openDocs}
              aria-label="Documentation"
            />
            <OrgSwitcher />
            <ScopeSwitcher />
            {account ? (
              <Button
                size="$2"
                chromeless
                icon={<SlidersHorizontal size={15} />}
                onPress={() => push('/settings')}
              >
                {account.displayName || account.name}
              </Button>
            ) : null}
            <Button size="$2" chromeless icon={<LogOut size={16} />} onPress={() => void signOut()}>
              Sign out
            </Button>
          </XStack>
        </XStack>

        {pathname !== '/' ? (
          <XStack px="$4" py="$2.5" borderBottomWidth={1} borderColor="$borderColor">
            <Breadcrumbs />
          </XStack>
        ) : null}

        <ScrollView flex={1}>
          <YStack flex={1} p="$4" gap="$4">
            {children}
          </YStack>
        </ScrollView>
      </YStack>
    </XStack>
  )
}
