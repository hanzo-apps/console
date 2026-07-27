'use client'

/**
 * Dashboard shell — a TWO-LEVEL sidebar (product list ⇄ drill into a product) + top
 * bar + content, responsive across phone / tablet / laptop / desktop.
 *
 * Level 1 (the product list) renders from the catalog: fixed Overview/Docs, a
 * Pinned section the user curates, then every product grouped by category. Each
 * CATEGORY is an INDEPENDENTLY collapsible section that renders EXPANDED by default
 * (nothing auto-collapses); the header is flush-left with the top-level items and
 * carries an OPTIONAL collapse chevron whose state persists per-user. Clicking a
 * PRODUCT that has sub-pages DRILLS the sidebar INTO that product's sub-nav
 * (Overview + specifics + the uniform base set: Settings · Status · Logs · Metrics)
 * with a clear BACK affordance to the full list — Level 2. A product with only an
 * Overview navigates directly (no drill). Sub-pages with no backend yet are dimmed
 * and open an honest placeholder (never a dead link).
 *
 * The WHOLE sidebar collapses to an icon RAIL (the topbar panel toggle, persisted).
 * When collapsed, HOVER reveals the full sidebar as an OVERLAY flyout (it doesn't
 * push the content) — the classic rail + flyout. On phones the sidebar is a LEFT
 * drawer (hamburger) instead; the collapse/rail is a desktop concern.
 *
 * The assistant docks: a floating bubble by default, or a PERMANENT right column
 * when docked (`useFloatingChat().docked`), which this shell reserves at `lg+`.
 *
 * Every product icon carries a tasteful per-product COLOR, recolorable/pinnable from
 * the customize pane — all persisted per-user via the account-backed preferences.
 *
 * Responsive (one breakpoint, `lg` = 1024px, CSS media style props):
 * - Desktop/laptop (≥lg): the persistent sidebar (rail or full) + inline topbar.
 * - Phone/tablet (<lg): the sidebar is a LEFT drawer (hamburger); the topbar
 *   condenses into a right-side account drawer. Touch targets ≥44px (hz-touch-target).
 *
 * Off-canvas surfaces (nav drawer, account menu, DetailPane) ride the ONE `SlideOver`
 * primitive. Layout responsiveness stays CSS-driven (`display="none"` + `$lg={{…}}`),
 * NOT a JS media branch, so SSR and first paint match. The nav body (`SidebarNav`) is
 * shared by the sidebar, the flyout, and the drawer (DRY) — one definition, many mounts.
 */
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Input, Popover, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpen,
  ChevronRight,
  ChevronsUpDown,
  Circle,
  CircleHelp,
  CircleUser,
  Command,
  CreditCard,
  ExternalLink,
  House,
  LayoutGrid,
  Lock,
  LogOut,
  Menu,
  PanelLeft,
  Plus,
  Repeat,
  ScrollText,
  Search,
  SlidersHorizontal,
  Star,
  Wallet,
  X,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import {
  visibleCatalogByCategory,
  findEntry,
  categorySlug,
  type CatalogEntry,
  type ProductCategory,
  type ProductSubpage,
} from '~/lib/products/registry'
import { productSubpages, subpageWired } from '~/lib/products/match'
import { ProductGuidePanel } from '~/components/guide/ProductGuidePanel'
import { ConsoleFooter } from '~/components/ConsoleFooter'
import { openProduct } from '~/lib/products/open'
import { entryMatches } from '~/lib/products/search'
import { usePins, useProductColors } from '~/lib/products/pins'
import { orderEntries } from '~/lib/products/order'
import { categoryIsOpen, toggleCategory, NAV_OPEN_PREF, EMPTY_OPEN, type CategoryOpen } from '~/lib/products/nav-accordion'
import { usePreferences } from '~/lib/products/preferences'
import { useSession } from '~/lib/auth/session'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { useEntitlements } from '~/lib/entitlements-context'
import { AddProductPanel } from '~/components/AddProductPanel'
import { SidebarWallet } from '~/components/SidebarWallet'
import { CommandSearchBox, useCommandPalette } from '~/components/CommandPalette'
import { useAppLauncher } from '~/components/AppLauncher'
import { useDetailPane } from '~/components/DetailPane'
import { ProductCustomize, ManagePins } from '~/components/SidebarCustomize'
import { SlideOver } from '@hanzo/ui/product'
import { ProductIcon } from '@hanzo/ui/product'
import { ThemeToggle } from '@hanzo/ui/product'
import { SystemStatusBadge } from '~/components/ui/SystemStatusBadge'
import { Breadcrumbs } from '~/components/ui/Breadcrumbs'
import { SidebarBrand } from '~/components/SidebarBrand'
import { BrandMark } from '~/components/ui/BrandLogo'
import { shellFor, isProductShell } from '~/lib/products/shell'
import { OrgSwitcher } from '~/components/OrgSwitcher'
import { leaveOrg } from '~/lib/org-scope'
import { ScopeSwitcher } from '~/components/ScopeSwitcher'
import { useFloatingChat, DockedChatPanel } from '~/components/FloatingChat'
import { WorkbenchDock } from '~/components/workbench/Workbench'

const EXPANDED_W = 264
const COLLAPSED_W = 64
/** Docked-assistant right column width (lg+ only). */
const DOCK_W = 384
/** Content column cap — wide desktops read comfortably (generous gutters) instead of
 *  stretching full-bleed; narrower viewports fall back to full width. */
const CONTENT_MAX = 1680
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

/** Icons for the Billing Center tabs — used by the billing-only shell nav. */
const BILLING_SUBPAGE_ICON: Record<string, ComponentType<{ size?: number }>> = {
  '': House,
  reports: BarChart3,
  budgets: Bell,
  invoices: ScrollText,
  subscriptions: Repeat,
  'payment-methods': CreditCard,
  credits: Wallet,
}
const billingSubpageIcon = (slug: string): ComponentType<{ size?: number }> => BILLING_SUBPAGE_ICON[slug] ?? Circle

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

/** A small round color dot — the "customize this product" affordance on a pin. */
function ColorDot({ color, onPress, label }: { color: string; onPress: () => void; label: string }) {
  return (
    <XStack
      onPress={onPress}
      cursor="pointer"
      width={22}
      height={22}
      items="center"
      justify="center"
      rounded="$10"
      hoverStyle={{ bg: '$color4' }}
      aria-label={label}
    >
      <XStack width={12} height={12} rounded="$10" style={{ backgroundColor: color }} />
    </XStack>
  )
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
      bg={active ? '$color4' : 'transparent'}
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

/** A level-1 catalog row — colored product icon, opens the product; trailing is a
 *  pin star (catalog rows) or a color/customize dot (pinned rows). */
function NavRow({
  entry,
  active,
  color,
  collapsed,
  pinned,
  onOpen,
  onToggle,
  onCustomize,
}: {
  entry: CatalogEntry
  active: boolean
  color: string
  collapsed: boolean
  pinned?: boolean
  onOpen: () => void
  onToggle?: () => void
  onCustomize?: () => void
}) {
  const Icon = entry.icon
  if (collapsed) {
    return (
      <Button
        onPress={onOpen}
        bg={active ? '$color4' : 'transparent'}
        justify="center"
        px="$0"
        height={44}
        icon={<ProductIcon icon={Icon} color={color} size={ICON} />}
        size="$3"
        aria-label={entry.label}
      />
    )
  }
  const hint = entry.admin ? (
    <Lock size={12} opacity={0.45} />
  ) : entry.kind === 'external' ? (
    <ExternalLink size={12} opacity={0.45} />
  ) : undefined
  return (
    <XStack items="center" gap="$1">
      <Button
        flex={1}
        onPress={onOpen}
        bg={active ? '$color4' : 'transparent'}
        justify="flex-start"
        icon={<ProductIcon icon={Icon} color={color} size={18} />}
        iconAfter={hint}
        size="$3"
      >
        {entry.label}
      </Button>
      {onCustomize ? (
        <ColorDot color={color} onPress={onCustomize} label={`Customize ${entry.label}`} />
      ) : onToggle ? (
        <Button
          size="$2"
          chromeless
          opacity={pinned ? 1 : 0.3}
          icon={<Star size={15} />}
          onPress={onToggle}
          aria-label={pinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
        />
      ) : null}
    </XStack>
  )
}

/**
 * Level 2 — the drilled product's sub-nav. Reached by clicking a product with
 * sub-pages; a BACK affordance returns to the full product list (Level 1). The
 * header shows the product (colored icon + name) under a category breadcrumb; the
 * body is `productSubpages(entry)` — Overview + specifics + the uniform base set —
 * with an unwired sub-page dimmed but honest (opens a placeholder, never a dead link).
 */
function DrillNav({
  entry,
  subs,
  pathname,
  color,
  onBack,
  onGo,
}: {
  entry: CatalogEntry
  subs: ProductSubpage[]
  pathname: string
  color: string
  onBack: () => void
  onGo: (path: string) => void
}) {
  const activeSlug = activeSubpageSlug(pathname, entry.id)
  const Icon = entry.icon
  return (
    <>
      {/* Back to the full product list, with the category as a quiet breadcrumb. */}
      <Button
        chromeless
        size="$2"
        height={34}
        px="$2"
        justify="flex-start"
        icon={<ArrowLeft size={17} />}
        onPress={onBack}
        hoverStyle={{ bg: '$color3' }}
        aria-label="Back to all products"
      >
        <Text fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase" letterSpacing={0.4}>
          {entry.category}
        </Text>
      </Button>

      {/* The product header. */}
      <XStack items="center" gap="$2.5" px="$2" py="$1.5" mb="$1">
        <ProductIcon icon={Icon} color={color} size={22} />
        <Text flex={1} fontSize="$5" fontWeight="800" color="$color12" numberOfLines={1}>
          {entry.label}
        </Text>
      </XStack>

      <ScrollView flex={1} minH={0}>
        <YStack gap="$0.5">
          {subs.map((sp) => {
            const wired = subpageWired(entry.id, sp.slug)
            const active = sp.slug === activeSlug
            const SubIcon = sp.icon ?? subpageIcon(sp.slug)
            return (
              <Button
                key={sp.slug || 'overview'}
                onPress={() => onGo(sp.slug ? `/${entry.id}/${sp.slug}` : `/${entry.id}`)}
                bg={active ? '$color4' : 'transparent'}
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

/** A collapsible level-1 CATEGORY section — the ONE way the expanded sidebar groups
 *  products under a topic. EXPANDED by default; the header is FLUSH-LEFT (aligned
 *  with Overview/Docs — no leading-chevron indentation) and carries the count plus an
 *  OPTIONAL collapse chevron (▾ open, ▸ collapsed) at the RIGHT. The whole header is
 *  the toggle (a big, keyboard-focusable, `aria-expanded` hit target). The body
 *  animates height + opacity via `.hz-acc` (grid-rows, reduced-motion-guarded) and is
 *  `inert` when collapsed, so hidden rows leave the tab order. */
function CategorySection({
  category,
  count,
  open,
  onToggle,
  children,
}: {
  category: ProductCategory
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const sectionId = `nav-cat-${categorySlug(category)}`
  return (
    <YStack gap="$1.5">
      <Button
        chromeless
        size="$2"
        height={32}
        px="$2.5"
        rounded="$3"
        justify="flex-start"
        onPress={onToggle}
        hoverStyle={{ bg: '$color3' }}
        focusStyle={{ bg: '$color3' }}
        aria-expanded={open}
        aria-controls={sectionId}
        aria-label={`${category}, ${open ? 'collapse' : 'expand'} section, ${count} items`}
      >
        <XStack flex={1} items="center" gap="$2">
          {/* Flush-left label — calm neutral tint (per-product COLOR lives on the icons
              within). The count + the collapse chevron sit at the far RIGHT. */}
          <Text flex={1} fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase" letterSpacing={0.4}>
            {category}
          </Text>
          <Text fontSize={10} fontWeight="700" color="$color9">
            {count}
          </Text>
          {/* The OPTIONAL collapse affordance — a chevron that rotates ▸→▾. Wrapped in a
              plain span so the CSS transition (`.hz-chevron`) applies (the Gui icon
              takes style props, not className). */}
          <span
            className="hz-chevron"
            style={{ display: 'inline-flex', transform: open ? 'rotate(90deg)' : undefined }}
          >
            <ChevronRight size={13} color="$color8" />
          </span>
        </XStack>
      </Button>
      <div className="hz-acc" data-open={open ? 'true' : 'false'} id={sectionId} inert={!open}>
        <div className="hz-acc-inner">
          <YStack gap="$1.5" pb="$2">
            {children}
          </YStack>
        </div>
      </div>
    </YStack>
  )
}

/** A square identity avatar — the account/org image when set, else initials on a tile. */
function IdentityAvatar({ src, label, size }: { src?: string | null; label: string; size: number }) {
  if (src) {
    // Arbitrary account/org image URL — raw <img> (next/image needs a per-tenant allowlist).
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={{ height: size, width: size, borderRadius: 8, objectFit: 'cover', display: 'block', flexShrink: 0 }} />
  }
  const initials = (label.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || 'U').toUpperCase()
  return (
    <XStack width={size} height={size} items="center" justify="center" rounded="$3" bg="$color5" style={{ flexShrink: 0 }}>
      <Text fontSize={Math.round(size * 0.4)} fontWeight="800" color="$color12">
        {initials}
      </Text>
    </XStack>
  )
}

/** One row in the account menu popover. */
function MenuItem({ icon: Icon, label, onPress }: { icon: ComponentType<{ size?: number }>; label: string; onPress: () => void }) {
  return (
    <XStack
      onPress={onPress}
      cursor="pointer"
      items="center"
      gap="$2.5"
      px="$2"
      py="$2"
      rounded="$3"
      hoverStyle={{ bg: '$color4' }}
    >
      <Icon size={15} />
      <Text fontSize="$2" color="$color12">
        {label}
      </Text>
    </XStack>
  )
}

/**
 * Sidebar identity — the BOTTOM-LEFT cluster (org switcher above the user/account
 * row), matching the unified app/chat shell. The org row is the working `OrgSwitcher`
 * (switch / create org / "All organizations" all live IN its dropdown now — the
 * former redundant app-grid button beside it is gone). The user row opens an account
 * menu (profile · theme · sign out). Because it sits at the FOOT of the sidebar, the
 * account menu opens UPWARD (`top-start`). Collapsed → just the account avatar,
 * opening the same menu to the right. Reused by the desktop sidebar, the flyout, AND
 * the mobile drawer (DRY).
 */
function SidebarIdentity({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  const router = useRouter()
  const { account, signOut } = useSession()
  const [open, setOpen] = useState(false)
  const name = account?.displayName?.trim() || account?.name || 'Account'
  const email = account?.email
  const go = (path: string) => {
    setOpen(false)
    router.push(path)
    onNavigate()
  }

  const menu = (
    <Popover.Content bordered elevate p="$2" width={252} bg="$color2" borderColor="$borderColor">
      <YStack gap="$1">
        <XStack items="center" gap="$2.5" px="$2" py="$2">
          <IdentityAvatar src={account?.avatar} label={name} size={34} />
          <YStack flex={1} minW={0}>
            <Text fontSize="$3" fontWeight="700" color="$color12" numberOfLines={1}>
              {name}
            </Text>
            {email ? (
              <Text fontSize="$1" color="$color10" numberOfLines={1}>
                {email}
              </Text>
            ) : null}
          </YStack>
        </XStack>
        <MenuItem icon={CircleUser} label="Profile" onPress={() => go('/profile')} />
        <XStack items="center" justify="space-between" px="$2" py="$1.5">
          <Text fontSize="$2" color="$color11">
            Theme
          </Text>
          <ThemeToggle />
        </XStack>
        <YStack borderTopWidth={1} borderColor="$borderColor" pt="$1">
          <MenuItem icon={LogOut} label="Sign out" onPress={() => { setOpen(false); void signOut() }} />
        </YStack>
      </YStack>
    </Popover.Content>
  )

  if (collapsed) {
    return (
      <YStack items="center" gap="$1" pt="$2" mt="$1" borderTopWidth={1} borderColor="$borderColor">
        <Popover open={open} onOpenChange={setOpen} placement="right-start">
          <Popover.Trigger asChild>
            <Button chromeless p="$0" width={40} height={40} aria-label={`${name} · account menu`}>
              <IdentityAvatar src={account?.avatar} label={name} size={36} />
            </Button>
          </Popover.Trigger>
          {menu}
        </Popover>
      </YStack>
    )
  }

  return (
    <YStack gap="$1.5" pt="$2" mt="$1" borderTopWidth={1} borderColor="$borderColor">
      {/* The current org — the working switch/create control (org avatar + name +
          "All organizations" all inside its dropdown). Top of the cluster. */}
      <XStack px="$1" items="center">
        <OrgSwitcher />
      </XStack>
      {/* The user/account — opens UPWARD (foot-anchored), so the menu never clips. */}
      <Popover open={open} onOpenChange={setOpen} placement="top-start">
        <Popover.Trigger asChild>
          <Button chromeless height={44} px="$2" justify="flex-start" aria-label={`${name} · account menu`}>
            <XStack items="center" gap="$2.5" flex={1} minW={0}>
              <IdentityAvatar src={account?.avatar} label={name} size={30} />
              <YStack flex={1} minW={0}>
                <Text fontSize="$4" fontWeight="800" color="$color12" numberOfLines={1}>
                  {name}
                </Text>
                {email ? (
                  <Text fontSize="$1" color="$color10" numberOfLines={1}>
                    {email}
                  </Text>
                ) : null}
              </YStack>
              <ChevronsUpDown size={15} color="$color9" />
            </XStack>
          </Button>
        </Popover.Trigger>
        {menu}
      </Popover>
    </YStack>
  )
}

/**
 * The nav body — shared by the persistent desktop sidebar, the collapsed-rail flyout,
 * and the mobile drawer. `onNavigate` closes the drawer on a LEAF selection (desktop
 * / flyout pass a no-op). Owns the Level-1 ⇄ Level-2 (drill-in) state.
 */
function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate: () => void
}) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const { view, isPinned, toggle, pinnedIds } = usePins()
  const { colorOf } = useProductColors()
  const detail = useDetailPane()
  const showAdmin = useIsSuperAdmin()
  // Entitlement scope: currently ungated in prod (the endpoint 404s → `enabled` is
  // null → the full catalog shows), matching "every product is always available".
  const { enabled } = useEntitlements()
  const [filter, setFilter] = useState('')

  // Collapsible-category accordion state — the user's EXPLICIT per-category collapse
  // choices, persisted per-user. Everything is EXPANDED by default; a collapsed
  // section stays collapsed where the user left it (see `categoryIsOpen`).
  const prefs = usePreferences()
  const navOpen = prefs.get<CategoryOpen>(NAV_OPEN_PREF, EMPTY_OPEN)
  const toggleSection = (category: string) => prefs.set(NAV_OPEN_PREF, toggleCategory(navOpen, category))

  // ── Drill-in state (Level 1 ⇄ Level 2) ────────────────────────────────────
  const activeId = activeModuleId(pathname)
  const activeEntry = activeId ? findEntry(activeId) ?? null : null
  const activeSubs = useMemo(
    () => (activeEntry && activeEntry.kind === 'module' ? productSubpages(activeEntry, showAdmin) : []),
    [activeEntry, showAdmin],
  )
  // `manualList` = the user hit BACK — force the Level-1 list even though the active
  // route is a drillable product. Entering a DIFFERENT product resets it (auto-drill).
  const [manualList, setManualList] = useState(false)
  useEffect(() => {
    setManualList(false)
  }, [activeId])
  const canDrill = Boolean(activeEntry) && activeSubs.length > 1
  const drilled = canDrill && !manualList && !collapsed
  const isActive = (id: string) => pathname === `/${id}` || pathname.startsWith(`/${id}/`)

  // Navigate to a LEAF (a sub-page or a no-sub-page product) — closes the drawer.
  const go = (path: string) => {
    router.push(path)
    onNavigate()
  }
  // Open a product from the list: DRILL if it has sub-pages (keep the drawer open so
  // the sub-nav shows), else navigate directly (leaf → close the drawer). An external
  // launch tile opens its deployed app in a new tab.
  const open = (entry: CatalogEntry) => {
    if (entry.kind === 'external') {
      openProduct(entry, go)
      onNavigate()
      return
    }
    setFilter('')
    const subs = productSubpages(entry, showAdmin)
    if (subs.length > 1) {
      setManualList(false)
      router.push(`/${entry.id}`) // DRILL — keep the drawer open for the sub-nav
    } else {
      go(`/${entry.id}`) // leaf — navigate + close
    }
  }
  const openDocs = () => {
    if (typeof window !== 'undefined') window.open(config.docsUrl, '_blank', 'noopener')
    onNavigate()
  }

  // Customize + manage + all-products panes — open the ONE DetailPane (DRY).
  const customize = (entry: CatalogEntry) =>
    detail.open({
      title: entry.label,
      subtitle: `${entry.category} · customize`,
      icon: entry.icon,
      iconColor: colorOf(entry.id),
      content: <ProductCustomize id={entry.id} />,
    })
  const manage = () =>
    detail.open({ title: 'Manage pins', subtitle: 'Reorder · group · organize', icon: Star, content: <ManagePins /> })
  // Browse the FULL catalog: pin/unpin to the sidebar + find what's in use (the
  // reworked panel — no enable gate; every product is always available).
  const allProducts = () =>
    detail.open({
      title: 'All products',
      subtitle: 'Pin to your sidebar · find what’s in use',
      icon: LayoutGrid,
      content: <AddProductPanel />,
    })

  const q = (collapsed ? '' : filter).trim().toLowerCase()
  const filtering = q.length > 0

  // Grouped pins, gated so a customer never sees an admin-only surface.
  const pinnedGroups = useMemo(
    () =>
      view
        .map((g) => ({
          ...g,
          entries: g.entries.filter((e) => {
            const found = findEntry(e.id)
            return Boolean(found) && (showAdmin || !found!.admin)
          }),
        }))
        .filter((g) => g.entries.length > 0),
    [view, showAdmin],
  )

  // Within-scope ordering is CONTINUOUS ALPHABETICAL with the SELECTED product pinned
  // first — via the ONE shared `orderEntries` helper. Categories stay in their
  // canonical order; only the items inside each are alphabetized + selected-first.
  const groups = useMemo(
    () =>
      visibleCatalogByCategory(showAdmin, enabled)
        .map((g) => ({ category: g.category, entries: orderEntries(g.entries.filter((e) => entryMatches(e, q)), activeId) }))
        .filter((g) => g.entries.length > 0),
    [q, showAdmin, enabled, activeId],
  )

  // ── Product-shell face — the nav IS the root module's sub-pages ────────────
  if (isProductShell(config.shell)) {
    const shell = shellFor(config.shell)
    const rootId = shell.rootId ?? ''
    const root = findEntry(rootId)
    const subs: ProductSubpage[] =
      root && root.kind === 'module'
        ? [{ slug: '', label: shell.indexLabel }, ...(root.subpages ?? []).filter((s) => showAdmin || !s.admin)]
        : []
    const activeSlug = root ? activeSubpageSlug(pathname, root.id) : ''
    return (
      <>
        {shell.wordmark && !collapsed ? (
          <XStack
            items="center"
            gap="$2"
            height={40}
            pl="$1"
            cursor="pointer"
            onPress={() => go(shell.home ? `/${shell.home}` : '/')}
            aria-label={`${shell.wordmark} — home`}
          >
            <BrandMark size={22} />
            <Text fontWeight="800" fontSize="$5" color="$color12">
              {shell.wordmark}
            </Text>
          </XStack>
        ) : (
          <SidebarBrand collapsed={collapsed} onNavigate={onNavigate} />
        )}
        <ScrollView flex={1}>
          <YStack gap="$1">
            {subs.map((sp) => {
              const active = sp.slug === activeSlug
              const SubIcon = sp.icon ?? billingSubpageIcon(sp.slug)
              return (
                <Button
                  key={sp.slug || 'overview'}
                  onPress={() => go(sp.slug ? `/${rootId}/${sp.slug}` : `/${rootId}`)}
                  bg={active ? '$color4' : 'transparent'}
                  justify={collapsed ? 'center' : 'flex-start'}
                  px={collapsed ? '$0' : '$2.5'}
                  height={collapsed ? 44 : undefined}
                  icon={<SubIcon size={collapsed ? ICON : 17} />}
                  size="$3"
                  aria-label={sp.label}
                >
                  {collapsed ? undefined : sp.label}
                </Button>
              )
            })}
          </YStack>
        </ScrollView>
        <SidebarIdentity collapsed={collapsed} onNavigate={onNavigate} />
        <SidebarWallet collapsed={collapsed} />
      </>
    )
  }

  // ── Collapsed icon rail — brand mark; a CURATED set (pinned + the active product);
  //    All-products; account + wallet. Hover reveals the full nav as a flyout. ──
  if (collapsed) {
    const railIds: string[] = []
    const seen = new Set<string>()
    for (const id of [...pinnedIds, ...(activeId ? [activeId] : [])]) {
      const e = findEntry(id)
      if (e && !seen.has(id) && (showAdmin || !e.admin)) {
        seen.add(id)
        railIds.push(id)
      }
    }
    return (
      <>
        <SidebarBrand collapsed onNavigate={onNavigate} />
        <ScrollView flex={1}>
          <YStack gap="$3.5">
            <YStack gap="$1">
              <FixedRow icon={House} label="Overview" active={pathname === '/'} collapsed onPress={() => go('/')} />
              <FixedRow icon={BookOpen} label="Docs" external collapsed onPress={openDocs} />
            </YStack>
            {railIds.length > 0 ? (
              <YStack gap="$1">
                {railIds.map((id) => {
                  const entry = findEntry(id)
                  if (!entry) return null
                  return (
                    <NavRow
                      key={`rail-${id}`}
                      entry={entry}
                      active={isActive(id)}
                      color={colorOf(id)}
                      collapsed
                      onOpen={() => open(entry)}
                    />
                  )
                })}
              </YStack>
            ) : null}
            <FixedRow icon={LayoutGrid} label="All products" collapsed onPress={allProducts} />
          </YStack>
        </ScrollView>
        <SidebarIdentity collapsed onNavigate={onNavigate} />
        <SidebarWallet collapsed />
      </>
    )
  }

  // ── Level 2 — drilled into a product's sub-nav, with a BACK affordance ──
  if (drilled && activeEntry) {
    return (
      <>
        <SidebarBrand collapsed={false} onNavigate={onNavigate} />
        <DrillNav
          entry={activeEntry}
          subs={activeSubs}
          pathname={pathname}
          color={colorOf(activeEntry.id)}
          onBack={() => setManualList(true)}
          onGo={go}
        />
        <SidebarIdentity collapsed={false} onNavigate={onNavigate} />
        <SidebarWallet collapsed={false} />
      </>
    )
  }

  // ── Level 1 — the full product list: brand; filter; Overview/Docs; Pinned; every
  //    category (EXPANDED by default, collapsible); All-products; identity + wallet. ──
  return (
    <>
      <SidebarBrand collapsed={false} onNavigate={onNavigate} />

      {/* Product filter — narrows the whole list; a match from any category jumps
          straight there. Typing hides the section chrome so the list stays scannable. */}
      <XStack
        items="center"
        gap="$2"
        px="$2.5"
        mb="$2"
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

      <ScrollView flex={1} minH={0}>
        <YStack gap="$3.5">
          {!filtering ? (
            <YStack gap="$1">
              <FixedRow icon={House} label="Overview" active={pathname === '/'} collapsed={false} onPress={() => go('/')} />
              <FixedRow icon={BookOpen} label="Docs" external collapsed={false} onPress={openDocs} />
            </YStack>
          ) : null}

          {!filtering && pinnedGroups.length > 0 ? (
            <YStack gap="$1.5">
              <XStack items="center" justify="space-between" px="$2.5">
                <Text fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase" letterSpacing={0.4}>
                  Pinned
                </Text>
                <Button size="$1" chromeless onPress={manage} aria-label="Manage pins">
                  <Text fontSize="$1" color="$color10" fontWeight="700">
                    Manage
                  </Text>
                </Button>
              </XStack>
              {pinnedGroups.map((group) => (
                <YStack key={group.name || 'default'} gap="$1">
                  {group.name ? (
                    <Text px="$2.5" fontSize="$1" color="$color9" fontWeight="700">
                      {group.label}
                    </Text>
                  ) : null}
                  {group.entries.map((e) => {
                    const entry = findEntry(e.id)
                    if (!entry) return null
                    return (
                      <NavRow
                        key={`pin-${e.id}`}
                        entry={entry}
                        active={isActive(e.id)}
                        color={colorOf(e.id)}
                        collapsed={false}
                        pinned
                        onOpen={() => open(entry)}
                        onCustomize={() => customize(entry)}
                      />
                    )
                  })}
                </YStack>
              ))}
            </YStack>
          ) : null}

          {groups.map((group) => (
            <CategorySection
              key={group.category}
              category={group.category}
              count={group.entries.length}
              open={categoryIsOpen(navOpen, group.category, { filtering })}
              onToggle={() => toggleSection(group.category)}
            >
              {group.entries.map((entry) => (
                <NavRow
                  key={entry.id}
                  entry={entry}
                  active={isActive(entry.id)}
                  color={colorOf(entry.id)}
                  collapsed={false}
                  pinned={isPinned(entry.id)}
                  onOpen={() => open(entry)}
                  onToggle={() => toggle(entry.id)}
                />
              ))}
            </CategorySection>
          ))}

          {filtering && groups.length === 0 ? (
            <Text px="$2.5" py="$3" fontSize="$2" color="$color10">
              No products match “{filter.trim()}”.
            </Text>
          ) : null}

          {/* Browse the full catalog — pin/unpin + find what's in use. Always
              available (no enable gate; every product is always on). */}
          {!filtering ? (
            <Button
              size="$2"
              chromeless
              justify="flex-start"
              icon={<LayoutGrid size={16} />}
              onPress={allProducts}
              aria-label="All products"
              mt="$1"
            >
              <Text fontSize="$2" color="$color11" fontWeight="600">
                All products
              </Text>
            </Button>
          ) : null}
        </YStack>
      </ScrollView>

      {/* Bottom-left cluster: the org switcher + account menu, then the wallet. */}
      <SidebarIdentity collapsed={false} onNavigate={onNavigate} />
      <SidebarWallet collapsed={false} />
    </>
  )
}

/** Mobile/tablet nav drawer — the same SidebarNav, slid in from the LEFT (the
 *  hamburger is top-left and this is a left-nav), with a ⌘K search + Apps launcher
 *  at the top (the command surface, reachable on mobile). */
function NavDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const palette = useCommandPalette()
  const launcher = useAppLauncher()
  return (
    <SlideOver open={open} onClose={() => onOpenChange(false)} side="left" size={320} ariaLabel="Navigation">
      {/* `hz-touch-target` raises every control in the drawer to a ≥44px tap target
          on phones/tablets (see globals.css); the desktop sidebar stays dense. */}
      <YStack flex={1} minH={0} p="$3" gap="$2.5" className="hz-touch-target">
        <XStack gap="$2" items="center">
          <XStack
            flex={1}
            onPress={() => {
              onOpenChange(false)
              palette.open()
            }}
            cursor="pointer"
            items="center"
            gap="$2"
            px="$3"
            height={44}
            bg="$color2"
            borderWidth={1}
            borderColor="$borderColor"
            rounded="$4"
            hoverStyle={{ borderColor: '$color8' }}
          >
            <Search size={15} opacity={0.6} />
            <Text flex={1} fontSize="$3" color="$color10" numberOfLines={1}>
              Search or ask AI…
            </Text>
            <Command size={13} opacity={0.5} />
          </XStack>
          <Button
            size="$3"
            icon={<LayoutGrid size={18} />}
            onPress={() => {
              onOpenChange(false)
              launcher.open()
            }}
            borderWidth={1}
            borderColor="$borderColor"
            aria-label="Apps"
          />
          {/* Explicit close — right-aligned INSIDE the drawer header, always reachable
              on a 390px phone (backdrop/Escape still close too). */}
          <Button
            size="$3"
            chromeless
            minW={44}
            icon={<X size={20} />}
            onPress={() => onOpenChange(false)}
            borderWidth={1}
            borderColor="$borderColor"
            aria-label="Close navigation"
          />
        </XStack>
        <SidebarNav collapsed={false} onNavigate={() => onOpenChange(false)} />
      </YStack>
    </SlideOver>
  )
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const { signOut } = useSession()
  const { get, set } = usePreferences()
  const launcher = useAppLauncher()
  const { docked } = useFloatingChat()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // Collapsed-rail hover flyout (desktop only): the full sidebar overlays the content
  // without pushing it, revealed while the pointer is over the rail/flyout.
  const [flyout, setFlyout] = useState(false)

  const collapsed = get<boolean>('sidebarCollapsed', false)
  const toggleCollapsed = () => {
    setFlyout(false)
    set('sidebarCollapsed', !collapsed)
  }
  const push = (path: string) => router.push(path)
  const openDocs = () => {
    if (typeof window !== 'undefined') window.open(config.docsUrl, '_blank', 'noopener')
  }

  return (
    <XStack flex={1} minH="100vh" bg="$background">
      {/* Persistent sidebar — hidden below lg (1024px), shown at lg+. When collapsed
          it's an icon RAIL; hovering it reveals the full sidebar as an OVERLAY flyout
          (absolute, elevated) that doesn't push the content. */}
      <YStack display="none" $lg={{ display: 'flex' }}>
        {/* Plain div owns the HOVER (DOM mouseenter/leave — reliable, and a descendant
            move into the flyout never fires leave) + is the positioned anchor for the
            absolute flyout. The outer YStack only media-gates the whole sidebar to lg+. */}
        <div
          onMouseEnter={() => {
            if (collapsed) setFlyout(true)
          }}
          onMouseLeave={() => setFlyout(false)}
          style={{ position: 'relative', display: 'flex', flex: 1, alignSelf: 'stretch' }}
        >
          <YStack
            width={collapsed ? COLLAPSED_W : EXPANDED_W}
            minW={collapsed ? COLLAPSED_W : EXPANDED_W}
            p={collapsed ? '$2' : '$3.5'}
            gap="$2.5"
            borderRightWidth={1}
            borderColor="$borderColor"
            bg="$color1"
            className="hz-collapse"
            data-tour="nav"
          >
            <SidebarNav collapsed={collapsed} onNavigate={() => {}} />
          </YStack>

          {collapsed && flyout ? (
            <YStack
              position="absolute"
              t={0}
              l={0}
              b={0}
              width={EXPANDED_W}
              p="$3.5"
              gap="$2.5"
              bg="$color1"
              borderRightWidth={1}
              borderColor="$borderColor"
              className="hz-elevation-4"
              style={{ zIndex: 1000 }}
            >
              <SidebarNav collapsed={false} onNavigate={() => setFlyout(false)} />
            </YStack>
          ) : null}
        </div>
      </YStack>

      {/* Mobile/tablet nav drawer — opened by the hamburger (hidden ≥ lg). */}
      <NavDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />

      <YStack flex={1} minW={0}>
        <XStack
          className="hz-topbar"
          height={56}
          px="$3"
          items="center"
          gap="$2"
          $md={{ px: '$4', gap: '$3' }}
          $xl={{ px: '$6' }}
          borderBottomWidth={1}
          borderColor="$borderColor"
        >
          {/* Collapse the sidebar to an icon rail — the ONE collapse control (desktop). */}
          <Button
            size="$3"
            chromeless
            display="none"
            $lg={{ display: 'flex' }}
            icon={<PanelLeft size={ICON} />}
            onPress={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar to icons'}
          />

          {/* Hamburger — opens the LEFT nav drawer. Shown only below lg; ≥44×44 touch
              target (WCAG 2.5.5). Hidden at lg+, so no desktop impact. */}
          <Button
            size="$3"
            chromeless
            $lg={{ display: 'none' }}
            minW={44}
            minH={44}
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

          {/* Spacer — pushes the right-side controls to the edge at lg+. Below lg the
              search box fills the row (two flex:1 siblings would halve it). */}
          <XStack display="none" $lg={{ display: 'flex' }} flex={1} />

          {/* Full topbar controls — shown only at lg+. */}
          <XStack display="none" $lg={{ display: 'flex' }} items="center" gap="$2">
            <SystemStatusBadge />
            <ThemeToggle />
            <Button size="$2" chromeless icon={<CircleHelp size={16} />} onPress={openDocs} aria-label="Documentation" />
            <Button size="$2" chromeless icon={<Bell size={16} />} onPress={() => push('/alerts')} aria-label="Notifications" />
            <ScopeSwitcher />
          </XStack>

          {/* Compact topbar trigger — the switchers + account fold into a drawer. */}
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
          <XStack borderBottomWidth={1} borderColor="$borderColor" justify="center" px="$3" $md={{ px: '$4' }} $xl={{ px: '$6' }}>
            <XStack width="100%" maxW={CONTENT_MAX} py="$2.5">
              <Breadcrumbs />
            </XStack>
          </XStack>
        ) : null}

        {/* Content — a centered, capped column so wide desktops read comfortably. */}
        <ScrollView flex={1}>
          <XStack justify="center" px="$3" $md={{ px: '$4' }} $xl={{ px: '$6' }}>
            <YStack testID="product-content" width="100%" maxW={CONTENT_MAX} pt="$3" pb={80} $md={{ pt: '$4' }} $xl={{ pt: '$5', gap: '$5' }} gap="$4">
              <ProductGuidePanel pathname={pathname} />
              {children}
              <ConsoleFooter />
            </YStack>
          </XStack>
        </ScrollView>

        {/* Developers workbench — the persistent bottom dock (Overview · Logs ·
            Shell), available on every page without leaving it. Desktop-only. */}
        <WorkbenchDock />
      </YStack>

      {/* Docked assistant — a PERMANENT right column (lg+ only). Reserves its own
          width beside the content; toggled from the assistant header. On phones the
          assistant stays the floating bubble/sheet (no room for a column). */}
      <YStack
        display="none"
        $lg={{ display: docked ? 'flex' : 'none' }}
        width={DOCK_W}
        minW={DOCK_W}
        borderLeftWidth={1}
        borderColor="$borderColor"
        bg="$color1"
      >
        <DockedChatPanel />
      </YStack>

      {/* Mobile account drawer — org/scope switching, notifications, theme, docs,
          sign-out. The SAME SlideOver primitive as the nav drawer (DRY, smooth). */}
      <SlideOver open={menuOpen} onClose={() => setMenuOpen(false)} side="right" size={320} title="Account">
        <YStack gap="$2" className="hz-touch-target">
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
      </SlideOver>
    </XStack>
  )
}
