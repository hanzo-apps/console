'use client'

/**
 * Dashboard shell — a TWO-LEVEL sidebar (category → product → sub-pages) + top
 * bar + content, responsive across phone / tablet / laptop / desktop.
 *
 * Level 1 (the product list) renders from the catalog: fixed Overview/Docs, a
 * Pinned section the user curates, then every product grouped by category, with a
 * filter that narrows the whole list. Clicking a PRODUCT slides the sidebar INTO
 * that product's sub-nav (Linear-style); a back affordance returns to the list.
 * Level 2 is `productSubpages(entry)` — Overview + the product's specifics + the
 * uniform base set (Settings · Status · Logs · Metrics). Sub-pages with no backend
 * yet are dimmed and open an honest placeholder (never a dead link). The open
 * product follows the route, so landing on any product URL shows its sub-nav.
 *
 * Chrome: the sidebar shows only the brand H mark (→ Overview) — no wordmark and
 * no in-sidebar collapse toggle (collapse lives in the header, the one place).
 * Identity, balance, top-up, and Sign out live in the footer wallet; the header
 * keeps org/project/env switchers, theme, help, and notifications.
 *
 * Responsive (one breakpoint, `lg` = 1024px, applied with CSS media style props):
 * - Desktop/laptop (≥lg): the persistent sidebar is always on (collapsible from
 *   the header), and the topbar shows the full inline controls.
 * - Phone/tablet (<lg): the sidebar is HIDDEN and reached via a hamburger that
 *   opens the SAME two-level nav as a left drawer; the topbar condenses.
 *
 * Layout responsiveness is CSS-driven (`display="none"` + `$lg={{...}}`), NOT a
 * `useMedia()` JS branch, so SSR and the client's first paint emit identical
 * markup — no hydration mismatch, no flash of the compact layout on a wide
 * screen. The nav body (`SidebarNav`) is shared by the persistent sidebar and the
 * drawer (DRY) — one definition, two mounts.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Dialog, Input, ScrollView, Text, VisuallyHidden, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpen,
  Circle,
  CircleHelp,
  ExternalLink,
  House,
  LayoutGrid,
  Lock,
  LogOut,
  Menu,
  PanelLeft,
  ScrollText,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import {
  visibleCatalogByCategory,
  findEntry,
  type CatalogEntry,
  type ProductSubpage,
} from '~/lib/products/registry'
import { productSubpages, subpageWired } from '~/lib/products/match'
import { entryMatches } from '~/lib/products/search'
import { openProduct } from '~/lib/products/open'
import { useFavorites } from '~/lib/products/favorites'
import { usePreferences } from '~/lib/products/preferences'
import { useSession } from '~/lib/auth/session'
import { useIsGlobalAdmin } from '~/lib/auth/admin'
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

/** Default icon for a level-2 sub-page (base slugs get a real one; others a dot). */
const SUBPAGE_ICON: Record<string, ComponentType<{ size?: number }>> = {
  '': House,
  settings: SlidersHorizontal,
  status: Activity,
  logs: ScrollText,
  metrics: BarChart3,
}
const subpageIcon = (slug: string): ComponentType<{ size?: number }> => SUBPAGE_ICON[slug] ?? Circle

/** The active in-console module id for a path, or null (home / external / unknown). */
function activeModuleId(pathname: string): string | null {
  const seg = pathname.split('/').filter(Boolean)[0]
  if (!seg) return null
  const e = findEntry(seg)
  return e && e.kind === 'module' ? e.id : null
}

/** The active sub-page slug within a product ('' = Overview), or '' when elsewhere. */
function activeSubpageSlug(pathname: string, id: string): string {
  const segs = pathname.split('/').filter(Boolean)
  if (segs[0] !== id) return ''
  return segs[1] ?? ''
}

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

/** A level-1 catalog row — opens the product (module → slide to its sub-nav;
 *  external → new tab), with a pin toggle and honest status hints. */
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

/** Level 2 — the open product's sub-nav (back + product header + sub-pages). */
function Level2Nav({
  entry,
  pathname,
  showAdmin,
  onBack,
  onGo,
}: {
  entry: CatalogEntry
  pathname: string
  showAdmin: boolean
  onBack: () => void
  onGo: (path: string) => void
}) {
  const Icon = entry.icon
  const subs = productSubpages(entry, showAdmin)
  const activeSlug = activeSubpageSlug(pathname, entry.id)
  return (
    <>
      <XStack items="center" gap="$1" mb="$1" height={36}>
        <Button size="$2" chromeless icon={<ArrowLeft size={18} />} onPress={onBack} aria-label="Back to products" />
        <XStack items="center" gap="$2" flex={1} minW={0}>
          <Icon size={18} />
          <Text fontSize="$4" fontWeight="800" color="$color12" numberOfLines={1}>
            {entry.label}
          </Text>
        </XStack>
      </XStack>
      <ScrollView flex={1}>
        <YStack gap="$1">
          {subs.map((sp: ProductSubpage) => {
            const wired = subpageWired(entry.id, sp.slug)
            const active = sp.slug === activeSlug
            const SubIcon = subpageIcon(sp.slug)
            return (
              <Button
                key={sp.slug || 'overview'}
                onPress={() => onGo(sp.slug ? `/${entry.id}/${sp.slug}` : `/${entry.id}`)}
                bg={active ? '$color5' : 'transparent'}
                justify="flex-start"
                icon={<SubIcon size={17} />}
                iconAfter={!wired ? <Circle size={7} opacity={0.5} /> : undefined}
                size="$3"
                opacity={wired ? 1 : 0.6}
                aria-label={wired ? sp.label : `${sp.label} (not available yet)`}
              >
                {sp.label}
              </Button>
            )
          })}
        </YStack>
      </ScrollView>
    </>
  )
}

/**
 * The nav body — shared by the persistent desktop sidebar and the mobile drawer.
 * `onNavigate` lets the drawer close on a leaf selection (desktop passes a no-op).
 */
function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { pinned, toggle, isPinned } = useFavorites()
  const launcher = useAppLauncher()
  const showAdmin = useIsGlobalAdmin()
  const [filter, setFilter] = useState('')

  // The open product's sub-nav (level 2) FOLLOWS the route: navigating to a
  // different product opens its sub-nav; Back returns to the list without moving.
  const activeId = activeModuleId(pathname)
  const [openId, setOpenId] = useState<string | null>(activeId)
  const prevActive = useRef(activeId)
  useEffect(() => {
    if (activeId !== prevActive.current) {
      prevActive.current = activeId
      setOpenId(activeId)
    }
  }, [activeId])

  const isActive = (id: string) => pathname === `/${id}` || pathname.startsWith(`/${id}/`)

  // Go to a path and (for a leaf/drawer) close. Opening a product does NOT close —
  // it reveals the sub-nav first.
  const go = (path: string) => {
    router.push(path)
    onNavigate()
  }
  const open = (entry: CatalogEntry) => {
    if (entry.kind === 'external') {
      openProduct(entry, () => {})
      onNavigate()
      return
    }
    setOpenId(entry.id)
    router.push(`/${entry.id}`)
  }
  const openDocs = () => {
    if (typeof window !== 'undefined') window.open(config.docsUrl, '_blank', 'noopener')
    onNavigate()
  }

  const openEntry = openId ? findEntry(openId) : undefined
  // Never slide into an admin product's sub-nav for a customer (they'd see a
  // surface they can't use); the content shows the managed notice instead.
  const showLevel2 =
    !collapsed && Boolean(openEntry && openEntry.kind === 'module' && (showAdmin || !openEntry.admin))

  // Pins and the catalog are gated: a customer never sees admin-only surfaces
  // (a pin from a prior global session is hidden too, not a dead row).
  const pinnedEntries = pinned
    .map((id) => findEntry(id))
    .filter((e): e is CatalogEntry => Boolean(e) && (showAdmin || !e!.admin))

  const q = (collapsed ? '' : filter).trim().toLowerCase()
  const filtering = q.length > 0
  const groups = useMemo(
    () =>
      visibleCatalogByCategory(showAdmin)
        .map((g) => ({ category: g.category, entries: g.entries.filter((e) => entryMatches(e, q)) }))
        .filter((g) => g.entries.length > 0),
    [q, showAdmin],
  )

  // ── Collapsed icon rail — one level (products as icons); expand for sub-nav ──
  if (collapsed) {
    return (
      <>
        <YStack items="center" mb="$1">
          <Button
            size="$3"
            chromeless
            onPress={() => go('/')}
            icon={<BrandLogo size={22} wordmark={false} />}
            aria-label="Overview"
          />
        </YStack>
        <ScrollView flex={1}>
          <YStack gap="$3">
            <YStack gap="$1">
              <FixedRow icon={House} label="Overview" active={pathname === '/'} collapsed onPress={() => go('/')} />
              <FixedRow icon={BookOpen} label="Docs" external collapsed onPress={openDocs} />
            </YStack>
            {pinnedEntries.length > 0 ? (
              <YStack gap="$1">
                {pinnedEntries.map((entry) => (
                  <NavRow
                    key={`pin-${entry.id}`}
                    entry={entry}
                    active={entry.kind === 'module' && isActive(entry.id)}
                    pinned
                    collapsed
                    onOpen={() => open(entry)}
                    onToggle={() => toggle(entry.id)}
                  />
                ))}
              </YStack>
            ) : null}
            {groups.map((group) => (
              <YStack key={group.category} gap="$1">
                {group.entries.map((entry) => (
                  <NavRow
                    key={entry.id}
                    entry={entry}
                    active={entry.kind === 'module' && isActive(entry.id)}
                    pinned={isPinned(entry.id)}
                    collapsed
                    onOpen={() => open(entry)}
                    onToggle={() => toggle(entry.id)}
                  />
                ))}
              </YStack>
            ))}
          </YStack>
        </ScrollView>
        <SidebarWallet collapsed />
      </>
    )
  }

  // ── Expanded: constant H-mark header + two-level slide + wallet footer ──
  return (
    <>
      <XStack items="center" height={36} mb="$1">
        <Button
          flex={1}
          chromeless
          justify="flex-start"
          px="$1"
          onPress={() => go('/')}
          aria-label="Overview"
        >
          <BrandLogo size={22} wordmark={false} />
        </Button>
      </XStack>

      {/* Two-level slide — level 1 (products) and level 2 (the open product's
          sub-nav) are stacked; the active one is on-screen, the other slid out.
          `.hz-slide` transitions the transform (reduced-motion aware). */}
      <YStack flex={1} minH={0} overflow="hidden" position="relative">
        {/* Level 1 — product list */}
        <YStack
          position="absolute"
          t={0}
          l={0}
          r={0}
          b={0}
          gap="$2"
          className="hz-slide"
          style={{ transform: showLevel2 ? 'translateX(-100%)' : 'translateX(0)' }}
          pointerEvents={showLevel2 ? 'none' : 'auto'}
          aria-hidden={showLevel2}
        >
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

          <ScrollView flex={1}>
            <YStack gap="$3">
              {!filtering ? (
                <YStack gap="$1">
                  <FixedRow icon={House} label="Overview" active={pathname === '/'} collapsed={false} onPress={() => go('/')} />
                  <FixedRow icon={BookOpen} label="Docs" external collapsed={false} onPress={openDocs} />
                </YStack>
              ) : null}

              {!filtering && pinnedEntries.length > 0 ? (
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
                      collapsed={false}
                      onOpen={() => open(entry)}
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
                      collapsed={false}
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
        </YStack>

        {/* Level 2 — the open product's sub-nav */}
        <YStack
          position="absolute"
          t={0}
          l={0}
          r={0}
          b={0}
          gap="$2"
          className="hz-slide"
          style={{ transform: showLevel2 ? 'translateX(0)' : 'translateX(100%)' }}
          pointerEvents={showLevel2 ? 'auto' : 'none'}
          aria-hidden={!showLevel2}
        >
          {openEntry && openEntry.kind === 'module' ? (
            <Level2Nav
              entry={openEntry}
              pathname={pathname}
              showAdmin={showAdmin}
              onBack={() => setOpenId(null)}
              onGo={go}
            />
          ) : null}
        </YStack>
      </YStack>

      <SidebarWallet collapsed={false} />
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
          <SidebarNav collapsed={false} onNavigate={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { signOut } = useSession()
  const { get, set } = usePreferences()
  const launcher = useAppLauncher()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const collapsed = get<boolean>('sidebarCollapsed', false)
  const toggleCollapsed = () => set('sidebarCollapsed', !collapsed)
  const push = (path: string) => router.push(path)
  const openDocs = () => {
    if (typeof window !== 'undefined') window.open(config.docsUrl, '_blank', 'noopener')
  }

  return (
    <XStack flex={1} minH="100vh" bg="$background">
      {/* Persistent sidebar — hidden below lg (1024px), shown at lg+. The width
          transition (`.hz-collapse`) animates the collapse smoothly. */}
      <YStack
        display="none"
        $lg={{ display: 'flex' }}
        width={collapsed ? COLLAPSED_W : EXPANDED_W}
        p="$3"
        gap="$2"
        borderRightWidth={1}
        borderColor="$borderColor"
        bg="$color1"
        className="hz-collapse"
      >
        <SidebarNav collapsed={collapsed} onNavigate={() => {}} />
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
          {/* Collapse the sidebar — the ONE collapse control (desktop only). */}
          <Button
            size="$3"
            chromeless
            display="none"
            $lg={{ display: 'flex' }}
            icon={<PanelLeft size={ICON} />}
            onPress={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          />

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

          {/* Apps launcher — icon-only below lg, labeled at lg+. */}
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

          {/* Full topbar controls — shown only at lg+. No user name and no Sign
              out here (both moved to the footer wallet). */}
          <XStack display="none" $lg={{ display: 'flex' }} items="center" gap="$2">
            <ThemeToggle />
            <Button
              size="$2"
              chromeless
              icon={<CircleHelp size={16} />}
              onPress={openDocs}
              aria-label="Documentation"
            />
            <Button
              size="$2"
              chromeless
              icon={<Bell size={16} />}
              onPress={() => push('/alerts')}
              aria-label="Notifications"
            />
            <OrgSwitcher />
            <ScopeSwitcher />
          </XStack>

          {/* Compact topbar trigger — the switchers + account fold into a menu. */}
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

      {/* Mobile overflow menu — org/scope switching, notifications, theme, docs,
          sign-out. Mounted always; opened only by the compact trigger (< lg). */}
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
                Account
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
                icon={<Bell size={16} />}
                onPress={() => {
                  setMenuOpen(false)
                  push('/alerts')
                }}
              >
                Notifications
              </Button>
              <Button
                justify="flex-start"
                icon={<SlidersHorizontal size={16} />}
                onPress={() => {
                  setMenuOpen(false)
                  push('/profile')
                }}
              >
                Profile
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
