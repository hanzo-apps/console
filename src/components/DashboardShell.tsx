'use client'

/**
 * Dashboard shell — sidebar (Overview + Docs + Pinned + categorized catalog) + top
 * bar + content, responsive across phone / tablet / laptop / desktop.
 *
 * The sidebar renders from the product catalog: fixed Overview/Docs links, a Pinned
 * section the user curates (favorites), then every product grouped by category. A
 * filter box narrows the whole sidebar so any product is one keystroke away, and
 * each catalog row carries a pin toggle. The brand "H" mark COLLAPSES/expands the
 * sidebar (icon-only ↔ full) on desktop, persisted to the account so it follows the
 * user. Active state is an EXACT match so e.g. `stores` never lights up while a
 * sibling is open. Adding a product to the catalog makes it appear here with no
 * shell edits.
 *
 * Responsive (one breakpoint, `lg` = 1024px, applied with CSS media style props):
 * - Desktop/laptop (≥lg): the persistent sidebar is always on (collapsible), and
 *   the topbar shows the full inline controls.
 * - Phone/tablet (<lg): the sidebar is HIDDEN and reachable via a hamburger in the
 *   topbar that opens the SAME nav as a left drawer (closes on select / backdrop);
 *   the topbar condenses — org/scope/user/sign-out fold into one overflow menu so
 *   nothing overflows at 375px.
 *
 * Layout responsiveness is CSS-driven (`display="none"` + `$lg={{ display:'flex' }}`),
 * NOT a JavaScript `useMedia()` branch. The browser resolves these media queries at
 * first paint, so the server and the client's first render emit IDENTICAL markup —
 * no hydration mismatch, and no flash of the compact layout on a wide screen (which
 * a JS branch would cause, since `useMedia()` reports "compact" until the client
 * mounts). The drawer/menu overlays stay mounted (closed); their triggers are
 * CSS-hidden ≥lg, so they can never open on desktop.
 *
 * The nav body (`SidebarNav`) is shared by the persistent sidebar and the drawer
 * (DRY) — one nav definition, two mounts.
 */
import { useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Dialog, Input, ScrollView, Text, VisuallyHidden, XStack, YStack } from '@hanzo/gui'
import {
  BookOpen,
  CircleHelp,
  ExternalLink,
  House,
  LayoutGrid,
  Lock,
  LogOut,
  Menu,
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
import { SidebarWallet } from '~/components/SidebarWallet'
import { CommandSearchBox } from '~/components/CommandPalette'
import { useAppLauncher } from '~/components/AppLauncher'
import { ThemeToggle } from '~/components/ui/ThemeToggle'
import { Breadcrumbs } from '~/components/ui/Breadcrumbs'
import { BrandLogo } from '~/components/ui/BrandLogo'
import { OrgSwitcher } from '~/components/OrgSwitcher'
import { ScopeSwitcher } from '~/components/ScopeSwitcher'

const EXPANDED_W = 264
const COLLAPSED_W = 64
/** Collapsed-rail icon size — large enough to be a comfortable hit target. */
const ICON = 20

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
      px={collapsed ? '$0' : '$2.5'}
      icon={<Icon size={ICON} />}
      iconAfter={!collapsed && external ? <ExternalLink size={12} opacity={0.4} /> : undefined}
      size="$3"
      height={collapsed ? 44 : undefined}
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
        px="$0"
        height={44}
        icon={<Icon size={ICON} />}
        size="$3"
        aria-label={entry.label}
      />
    )
  }
  // Every product opens natively now (no external link-out); the only nav hint is
  // the admin lock for access-gated surfaces.
  const hint = entry.admin ? <Lock size={12} opacity={0.45} /> : undefined
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

/**
 * The nav body — header, filter, scrollable catalog, wallet. Shared by the
 * persistent desktop sidebar and the mobile drawer. `onNavigate` lets the drawer
 * close itself when the user selects something (desktop passes a no-op).
 */
function SidebarNav({
  collapsed,
  collapsible,
  onNavigate,
}: {
  collapsed: boolean
  /** Desktop only: the H mark toggles collapse. In the drawer the nav is always full. */
  collapsible: boolean
  onNavigate: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { pinned, toggle, isPinned } = useFavorites()
  const { get, set } = usePreferences()
  const launcher = useAppLauncher()
  const [filter, setFilter] = useState('')

  const toggleCollapsed = () => set('sidebarCollapsed', !get<boolean>('sidebarCollapsed', false))

  const push = (path: string) => {
    router.push(path)
    onNavigate()
  }
  const open = (entry: CatalogEntry) => {
    openProduct(entry, (p) => router.push(p))
    onNavigate()
  }
  const isActive = (id: string) => pathname === `/${id}` || pathname.startsWith(`/${id}/`)
  const openDocs = () => {
    if (typeof window !== 'undefined') window.open(config.docsUrl, '_blank', 'noopener')
    onNavigate()
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
    <>
      {/* Header: the H mark toggles collapse (desktop); the grid opens the launcher. */}
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
            icon={<LayoutGrid size={ICON} />}
            onPress={() => {
              launcher.open()
              onNavigate()
            }}
            aria-label="All apps"
          />
        </YStack>
      ) : (
        <XStack items="center" gap="$1" mb="$1">
          <Button
            flex={1}
            onPress={collapsible ? toggleCollapsed : () => push('/')}
            bg="transparent"
            justify="flex-start"
            iconAfter={collapsible ? <PanelLeft size={15} opacity={0.4} /> : undefined}
            size="$3"
            aria-label={collapsible ? 'Collapse sidebar' : 'Overview'}
          >
            <BrandLogo size={22} />
          </Button>
          <Button
            size="$3"
            chromeless
            icon={<LayoutGrid size={18} />}
            onPress={() => {
              launcher.open()
              onNavigate()
            }}
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
                  active={isActive(entry.id)}
                  pinned
                  collapsed={collapsed}
                  onOpen={() => open(entry)}
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
                  active={isActive(entry.id)}
                  pinned={isPinned(entry.id)}
                  collapsed={collapsed}
                  onOpen={() => open(entry)}
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

      {/* Always-visible wallet: identity + balance + top-up, pinned bottom-left. */}
      <SidebarWallet collapsed={collapsed} />
    </>
  )
}

/** Mobile/tablet nav drawer — the same SidebarNav, slid in from the left. */
function NavDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog modal open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay key="nav-overlay" bg="rgba(0,0,0,0.55)" />
        <Dialog.Content
          key="nav-content"
          bordered
          elevate
          position="absolute"
          t={0}
          l={0}
          height="100dvh"
          width={300}
          maxW="86vw"
          p="$3"
          gap="$2"
          bg="$color1"
          rounded="$0"
        >
          <VisuallyHidden>
            <Dialog.Title>Navigation</Dialog.Title>
          </VisuallyHidden>
          <SidebarNav collapsed={false} collapsible={false} onNavigate={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { account, signOut } = useSession()
  const { get } = usePreferences()
  const launcher = useAppLauncher()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const collapsed = get<boolean>('sidebarCollapsed', false)
  const push = (path: string) => router.push(path)
  const openDocs = () => {
    if (typeof window !== 'undefined') window.open(config.docsUrl, '_blank', 'noopener')
  }

  // Layout responsiveness is CSS-driven (media style props), NOT a JS `useMedia`
  // branch — so the server and the client's first paint render identical markup
  // (no hydration mismatch, no flash of the wrong layout on a wide screen). The
  // persistent sidebar shows only ≥`lg`; the hamburger + compact menu show only
  // below `lg`. The drawer/menu overlays stay mounted (closed) — their triggers
  // are CSS-hidden on desktop, so they can never open there.
  return (
    <XStack flex={1} minH="100vh" bg="$background">
      {/* Persistent sidebar — hidden below lg (1024px), shown at lg+. */}
      <YStack
        display="none"
        $lg={{ display: 'flex' }}
        width={collapsed ? COLLAPSED_W : EXPANDED_W}
        p="$3"
        gap="$2"
        borderRightWidth={1}
        borderColor="$borderColor"
        bg="$color1"
      >
        <SidebarNav collapsed={collapsed} collapsible onNavigate={() => {}} />
      </YStack>

      {/* Mobile/tablet nav drawer — opened by the hamburger (hidden ≥ lg). */}
      <NavDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />

      <YStack flex={1} minW={0}>
        <XStack
          height={56}
          px="$3"
          items="center"
          gap="$2"
          $md={{ px: '$4', gap: '$3' }}
          borderBottomWidth={1}
          borderColor="$borderColor"
        >
          {/* Hamburger — opens the nav drawer. Shown only below lg. */}
          <Button
            size="$3"
            chromeless
            $lg={{ display: 'none' }}
            icon={<Menu size={ICON} />}
            onPress={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          />

          <CommandSearchBox />

          {/* Apps — icon-only below lg (saves topbar width on phones), labeled at
              lg+. The label is a CSS-hidden Text child (browser-resolved), so it
              toggles with no stale string-child re-render and no SSR flash. */}
          <Button
            size="$3"
            icon={<LayoutGrid size={18} />}
            onPress={launcher.open}
            borderWidth={1}
            borderColor="$borderColor"
            aria-label="Apps"
          >
            <Text display="none" $lg={{ display: 'flex' }}>
              Apps
            </Text>
          </Button>

          <XStack flex={1} />

          {/* Full topbar controls — shown only at lg+. */}
          <XStack display="none" $lg={{ display: 'flex' }} items="center" gap="$2">
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

          {/* Compact topbar trigger — the switchers + account fold into a menu.
              Shown only below lg. */}
          <Button
            size="$3"
            chromeless
            $lg={{ display: 'none' }}
            icon={<SlidersHorizontal size={18} />}
            onPress={() => setMenuOpen(true)}
            aria-label="Account and settings"
          />
        </XStack>

        {pathname !== '/' ? (
          <XStack px="$3" $md={{ px: '$4' }} py="$2.5" borderBottomWidth={1} borderColor="$borderColor">
            <Breadcrumbs />
          </XStack>
        ) : null}

        <ScrollView flex={1}>
          <YStack flex={1} p="$3" $md={{ p: '$4' }} gap="$4">
            {children}
          </YStack>
        </ScrollView>
      </YStack>

      {/* Mobile overflow menu — org/scope switching, settings, theme, sign-out.
          Mounted always; opened only by the compact trigger (hidden ≥ lg). */}
      <Dialog modal open={menuOpen} onOpenChange={setMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay key="menu-overlay" bg="rgba(0,0,0,0.55)" />
          <Dialog.Content
            key="menu-content"
            bordered
            elevate
            position="absolute"
            t={0}
            r={0}
            height="100dvh"
            width={300}
            maxW="86vw"
            p="$4"
            gap="$3"
            bg="$color1"
            rounded="$0"
          >
            <VisuallyHidden>
              <Dialog.Title>Account and settings</Dialog.Title>
            </VisuallyHidden>
            <XStack items="center" justify="space-between">
              <Text fontSize="$5" fontWeight="700" color="$color12">
                {account?.displayName || account?.name || 'Account'}
              </Text>
              <Button
                size="$2"
                chromeless
                icon={<X size={18} />}
                onPress={() => setMenuOpen(false)}
                aria-label="Close"
              />
            </XStack>

            <YStack gap="$2">
              <XStack items="center" justify="space-between">
                <Text fontSize="$2" color="$color10">
                  Theme
                </Text>
                <ThemeToggle />
              </XStack>
              <OrgSwitcher />
              <ScopeSwitcher />
              <Button
                justify="flex-start"
                icon={<SlidersHorizontal size={16} />}
                onPress={() => {
                  setMenuOpen(false)
                  push('/settings')
                }}
              >
                Settings
              </Button>
              <Button
                justify="flex-start"
                icon={<CircleHelp size={16} />}
                onPress={() => {
                  setMenuOpen(false)
                  openDocs()
                }}
              >
                Documentation
              </Button>
              <Button
                justify="flex-start"
                icon={<LogOut size={16} />}
                onPress={() => {
                  setMenuOpen(false)
                  void signOut()
                }}
              >
                Sign out
              </Button>
            </YStack>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </XStack>
  )
}
