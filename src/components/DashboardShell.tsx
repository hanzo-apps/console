'use client'

/**
 * Dashboard shell — a TWO-LEVEL sidebar (category → product → sub-pages) + top
 * bar + content, responsive across phone / tablet / laptop / desktop.
 *
 * Level 1 (the product list) renders from the catalog: fixed Overview/Docs, a
 * Pinned section the user curates (GROUPED + drag-reorderable via the Manage
 * pane), then every product grouped by category, with a filter that narrows the
 * whole list. Clicking a PRODUCT slides the sidebar INTO that product's sub-nav
 * (Linear-style); a back affordance and a CATEGORY breadcrumb (with sibling jumps)
 * return context. Level 2 is `productSubpages(entry)` — Overview + the product's
 * specifics + the uniform base set (Settings · Status · Logs · Metrics). Sub-pages
 * with no backend yet are dimmed and open an honest placeholder (never a dead
 * link).
 *
 * Every product icon carries a tasteful, per-product COLOR (Linear-style), which
 * the user can recolor, pin, and group from the customize pane — all persisted
 * per-user via the account-backed preferences (`usePins` / `useProductColors`).
 *
 * Responsive (one breakpoint, `lg` = 1024px, applied with CSS media style props):
 * - Desktop/laptop (≥lg): the persistent sidebar is always on (collapsible from
 *   the header); the topbar shows the full inline controls.
 * - Phone/tablet (<lg): the sidebar is HIDDEN and reached via a hamburger that
 *   opens the SAME two-level nav as a LEFT-side drawer (with ⌘K search + Apps at
 *   the top); the topbar condenses into a right-side account drawer.
 *
 * Off-canvas surfaces (nav drawer, account menu, item DetailPane) all ride the
 * ONE `SlideOver` primitive — transform-driven, so enter AND exit animate
 * smoothly (reduced-motion aware). Layout responsiveness stays CSS-driven
 * (`display="none"` + `$lg={{…}}`), NOT a JS media branch, so SSR and first paint
 * match (no hydration flash). The nav body (`SidebarNav`) is shared by the
 * persistent sidebar and the drawer (DRY) — one definition, two mounts.
 */
import { useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Input, Popover, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
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
  BILLING_CENTER_ID,
  type CatalogEntry,
  type ProductCategory,
  type ProductSubpage,
} from '~/lib/products/registry'
import { productSubpages, subpageWired } from '~/lib/products/match'
import { ProductUpstreamNote } from '~/components/products/ProductUpstreamNote'
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
import { SlideOver } from '~/components/ui/SlideOver'
import { ProductIcon } from '~/components/ui/ProductIcon'
import { ThemeToggle } from '~/components/ui/ThemeToggle'
import { SystemStatusBadge } from '~/components/ui/SystemStatusBadge'
import { Breadcrumbs } from '~/components/ui/Breadcrumbs'
import { BrandLogo } from '~/components/ui/BrandLogo'
import { OrgSwitcher } from '~/components/OrgSwitcher'
import { leaveOrg } from '~/lib/org-scope'
import { ScopeSwitcher } from '~/components/ScopeSwitcher'

const EXPANDED_W = 264
const COLLAPSED_W = 64
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

/** The CATEGORY of the product the path points at, or null (home / unknown) — the
 *  section the accordion keeps auto-expanded so the current page is always visible.
 *  Unlike `activeModuleId` this spans every kind (module + external both carry a
 *  category), so navigating to any product reveals its section. */
function activeCategory(pathname: string): string | null {
  const seg = pathname.split('/').filter(Boolean)[0]
  if (!seg) return null
  return findEntry(seg)?.category ?? null
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
 * The active product's sub-pages, rendered INLINE (indented) directly under its nav
 * row — Google-Cloud-Console style. So a product AND its sub-pages are reachable in a
 * single click from the always-visible list, with NO slide-out and NO "back" step
 * (the prior two-level nav required returning to the list to reach another product).
 * Overview + the product's specifics + the uniform base set (Settings · Status · Logs
 * · Metrics); an unwired sub-page is dimmed but honest (opens a placeholder, never a
 * dead link). Rendered only for the active product, and hidden while filtering.
 */
function InlineSubnav({
  entry,
  pathname,
  showAdmin,
  onGo,
}: {
  entry: CatalogEntry
  pathname: string
  showAdmin: boolean
  onGo: (path: string) => void
}) {
  const subs = productSubpages(entry, showAdmin)
  // Nothing beyond Overview → no sub-nav worth showing (the row itself is the page).
  if (subs.length <= 1) return null
  const activeSlug = activeSubpageSlug(pathname, entry.id)
  return (
    <YStack gap="$0.5" ml="$5" my="$0.5">
      {subs.map((sp: ProductSubpage) => {
        const wired = subpageWired(entry.id, sp.slug)
        const active = sp.slug === activeSlug
        const SubIcon = subpageIcon(sp.slug)
        return (
          <Button
            key={sp.slug || 'overview'}
            onPress={() => onGo(sp.slug ? `/${entry.id}/${sp.slug}` : `/${entry.id}`)}
            bg={active ? '$color4' : 'transparent'}
            justify="flex-start"
            icon={<SubIcon size={15} />}
            iconAfter={!wired ? <Circle size={7} opacity={0.5} /> : undefined}
            size="$2"
            opacity={wired ? 1 : 0.6}
            aria-label={wired ? sp.label : `${sp.label} (not available yet)`}
          >
            {sp.label}
          </Button>
        )
      })}
    </YStack>
  )
}

/** A collapsible level-1 CATEGORY section — the ONE way the expanded sidebar
 *  groups products under a topic. The header is a clickable button with an OBVIOUS
 *  rotating chevron (▸ collapsed, ▾ expanded), keyboard-toggleable and
 *  `aria-expanded`; its product rows (`children`) reveal in order when open. The
 *  body animates height + opacity via `.hz-acc` (grid-rows, reduced-motion-guarded)
 *  and is `inert` when collapsed, so hidden rows leave the tab order. The category
 *  label keeps its per-category accent color + a count of what's inside. */
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
        height={34}
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
          {/* The OBVIOUS clicker — a chevron that rotates ▸→▾ on expand. Wrapped in a
              plain span so the CSS transition (`.hz-chevron`) applies (the Gui icon
              takes style props, not className). Calm, neutral tint — the section header
              is quiet gray (Linear-style); per-product COLOR lives on the icons within. */}
          <span
            className="hz-chevron"
            style={{ display: 'inline-flex', transform: open ? 'rotate(90deg)' : undefined }}
          >
            <ChevronRight size={13} color="$color8" />
          </span>
          <Text fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase" letterSpacing={0.4}>
            {category}
          </Text>
          <XStack flex={1} />
          <Text fontSize={10} fontWeight="700" color="$color9">
            {count}
          </Text>
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
 * Sidebar identity — the ACCOUNT switcher on top with the current ORG below it
 * (Google-Cloud-Console style), replacing the old org-then-brand header. The user row
 * opens an account menu (profile · theme · sign out); the org row is the working
 * `OrgSwitcher` (switch / create org). Collapsed → just the account avatar, opening the
 * same menu. Reused by the desktop sidebar AND the mobile drawer (both mount
 * SidebarNav), so one definition, many mounts (DRY).
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
      <YStack items="center" gap="$1" mb="$1">
        <Popover open={open} onOpenChange={setOpen} placement="right-start">
          <Popover.Trigger asChild>
            <Button chromeless p="$0" width={40} height={40} aria-label={`${name} · account menu`}>
              <IdentityAvatar src={account?.avatar} label={name} size={36} />
            </Button>
          </Popover.Trigger>
          {menu}
        </Popover>
        <Button
          chromeless
          p="$0"
          width={40}
          height={32}
          icon={<LayoutGrid size={16} />}
          onPress={() => leaveOrg()}
          aria-label="All organizations — back to the org picker"
        />
      </YStack>
    )
  }

  return (
    <YStack gap="$1.5" mb="$1">
      <Popover open={open} onOpenChange={setOpen} placement="bottom-start">
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
      {/* The current org, directly below the user — the working switch/create control,
          with a Home affordance that de-scopes back to the org picker. */}
      <XStack px="$1" items="center" gap="$1" justify="space-between">
        <OrgSwitcher />
        <Button
          size="$2"
          chromeless
          icon={<LayoutGrid size={15} />}
          onPress={() => leaveOrg()}
          aria-label="All organizations — back to the org picker"
        />
      </XStack>
    </YStack>
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
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const { view, isPinned, toggle } = usePins()
  const { colorOf } = useProductColors()
  const detail = useDetailPane()
  const showAdmin = useIsSuperAdmin()
  // Entitlement gate: a customer's nav shows ONLY the products the org has enabled
  // (always-on essentials + `enabled`); `gated` is true once a real set is in force.
  const { enabled, gated } = useEntitlements()
  const [filter, setFilter] = useState('')

  // Collapsible-category accordion state — the user's explicit per-category open
  // choices, persisted per-user (account-backed + localStorage cache) so a
  // reload/navigation keeps them. The active route's category stays open (see
  // `categoryIsOpen`), so the current page is always visible.
  const prefs = usePreferences()
  const navOpen = prefs.get<CategoryOpen>(NAV_OPEN_PREF, EMPTY_OPEN)
  const activeCat = activeCategory(pathname)
  const toggleSection = (category: string) => prefs.set(NAV_OPEN_PREF, toggleCategory(navOpen, category))

  // The active product (from the route) is the one whose sub-pages expand inline.
  const activeId = activeModuleId(pathname)
  const isActive = (id: string) => pathname === `/${id}` || pathname.startsWith(`/${id}/`)

  const go = (path: string) => {
    router.push(path)
    onNavigate()
  }
  const open = (entry: CatalogEntry) => {
    // Route DIRECTLY to any product from anywhere in the always-visible list — no
    // slide, no "back" step. An external launch tile opens its deployed app in a new
    // tab (the ONE opener handles the kind); the drawer closes after either way.
    if (entry.kind === 'external') {
      openProduct(entry, go)
      onNavigate()
      return
    }
    setFilter('')
    router.push(`/${entry.id}`)
    onNavigate()
  }
  const openDocs = () => {
    if (typeof window !== 'undefined') window.open(config.docsUrl, '_blank', 'noopener')
    onNavigate()
  }

  // Customize + manage panes — open the ONE DetailPane with a descriptor (DRY).
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
  const pinnedIds = useMemo(() => pinnedGroups.flatMap((g) => g.entries.map((e) => e.id)), [pinnedGroups])

  // Within-scope ordering is CONTINUOUS ALPHABETICAL with the SELECTED product pinned
  // first (emphasized + kept visible), per directive #58 §2.2 — via the ONE shared
  // `orderEntries` helper (reused by the AppLauncher). Categories stay in their
  // canonical order; only the items inside each are alphabetized + selected-first.
  const groups = useMemo(
    () =>
      visibleCatalogByCategory(showAdmin, enabled)
        .map((g) => ({ category: g.category, entries: orderEntries(g.entries.filter((e) => entryMatches(e, q)), activeId) }))
        .filter((g) => g.entries.length > 0),
    [q, showAdmin, enabled, activeId],
  )

  // The "Add product" affordance — open the shared DetailPane onto the enable flow.
  const addProduct = () =>
    detail.open({
      title: 'Add product',
      subtitle: 'Enable more products for your organization',
      icon: Plus,
      content: <AddProductPanel />,
    })

  // ── Billing-only shell — the nav IS the Billing Center's tabs ─────────────
  // Same components, filtered nav: on billing.<brand> (or NEXT_PUBLIC_BILLING_ONLY)
  // the sidebar shows ONLY the Billing Center sub-pages (Overview · Reports ·
  // Budgets · Invoices · Subscriptions · Payment methods · Credits). The rest of the
  // chrome (header, cmd+K, org switcher, account menu, wallet footer) is untouched.
  if (config.billingOnly) {
    const billing = findEntry(BILLING_CENTER_ID)
    const subs: ProductSubpage[] =
      billing && billing.kind === 'module'
        ? [{ slug: '', label: 'Overview' }, ...(billing.subpages ?? []).filter((s) => showAdmin || !s.admin)]
        : []
    const activeSlug = billing ? activeSubpageSlug(pathname, billing.id) : ''
    return (
      <>
        <XStack items="center" height={36} mb="$2">
          <Button
            flex={collapsed ? undefined : 1}
            chromeless
            justify={collapsed ? 'center' : 'flex-start'}
            px="$1"
            onPress={() => go(`/${BILLING_CENTER_ID}`)}
            aria-label="Billing"
          >
            <BrandLogo size={22} wordmark={false} />
          </Button>
        </XStack>
        <ScrollView flex={1}>
          <YStack gap="$1">
            {subs.map((sp) => {
              const active = sp.slug === activeSlug
              const SubIcon = billingSubpageIcon(sp.slug)
              return (
                <Button
                  key={sp.slug || 'overview'}
                  onPress={() => go(sp.slug ? `/${BILLING_CENTER_ID}/${sp.slug}` : `/${BILLING_CENTER_ID}`)}
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
        <SidebarWallet collapsed={collapsed} />
      </>
    )
  }

  // ── Collapsed icon rail — account avatar + products as colored icons ──
  if (collapsed) {
    return (
      <>
        <SidebarIdentity collapsed onNavigate={onNavigate} />
        <ScrollView flex={1}>
          <YStack gap="$3.5">
            <YStack gap="$1">
              <FixedRow icon={House} label="Overview" active={pathname === '/'} collapsed onPress={() => go('/')} />
              <FixedRow icon={BookOpen} label="Docs" external collapsed onPress={openDocs} />
            </YStack>
            {pinnedIds.length > 0 ? (
              <YStack gap="$1">
                {pinnedIds.map((id) => {
                  const entry = findEntry(id)
                  if (!entry) return null
                  return (
                    <NavRow
                      key={`pin-${id}`}
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
            {groups.map((group) => (
              <YStack key={group.category} gap="$1">
                {group.entries.map((entry) => (
                  <NavRow
                    key={entry.id}
                    entry={entry}
                    active={isActive(entry.id)}
                    color={colorOf(entry.id)}
                    collapsed
                    onOpen={() => open(entry)}
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

  // ── Expanded: identity (user + org) + single-level grouped nav + wallet ──
  // Google-Cloud-Console style: ONE always-visible, scrollable list — Overview/Docs,
  // Pinned, then categories in fixed order (collapsible). The active product's
  // sub-pages expand INLINE under its row, so every product AND sub-page is one click
  // away with no slide and no "back".
  return (
    <>
      <SidebarIdentity collapsed={false} onNavigate={onNavigate} />

      {/* Product filter — narrows the whole list; a match from any category jumps
          straight there. Typing hides the inline sub-nav so the list stays scannable. */}
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
              <XStack items="center" justify="space-between" px="$2">
                <Text fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
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
                    <Text px="$2" fontSize="$1" color="$color9" fontWeight="700">
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
              open={categoryIsOpen(navOpen, group.category, { activeCategory: activeCat, filtering })}
              onToggle={() => toggleSection(group.category)}
            >
              {group.entries.map((entry) => (
                <YStack key={entry.id} gap="$0.5">
                  <NavRow
                    entry={entry}
                    active={isActive(entry.id)}
                    color={colorOf(entry.id)}
                    collapsed={false}
                    pinned={isPinned(entry.id)}
                    onOpen={() => open(entry)}
                    onToggle={() => toggle(entry.id)}
                  />
                  {/* The active product's sub-pages, inline (never a slide/back). */}
                  {!filtering && entry.kind === 'module' && isActive(entry.id) ? (
                    <InlineSubnav entry={entry} pathname={pathname} showAdmin={showAdmin} onGo={go} />
                  ) : null}
                </YStack>
              ))}
            </CategorySection>
          ))}

          {filtering && groups.length === 0 ? (
            <Text px="$2" py="$3" fontSize="$2" color="$color10">
              No products match “{filter.trim()}”.
            </Text>
          ) : null}

          {/* Out-of-box: a gated customer assembles their own backend — enable more
              products. Hidden for super admins (they see everything) and while the
              gate is ungated (endpoint not landed) so the nav is unchanged until then. */}
          {!filtering && gated ? (
            <Button
              size="$2"
              chromeless
              justify="flex-start"
              icon={<Plus size={16} />}
              onPress={addProduct}
              aria-label="Add product"
              mt="$1"
            >
              <Text fontSize="$2" color="$color11" fontWeight="600">
                Add product
              </Text>
            </Button>
          ) : null}
        </YStack>
      </ScrollView>

      <SidebarWallet collapsed={false} />
    </>
  )
}

/** Mobile/tablet nav drawer — the same SidebarNav, slid in from the LEFT (the
 *  hamburger is top-left and this is a left-nav, so the drawer enters from that
 *  edge; the account/profile drawer stays on the right), with a ⌘K search + Apps
 *  launcher at the top (the command surface, reachable on mobile). */
function NavDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const palette = useCommandPalette()
  const launcher = useAppLauncher()
  return (
    <SlideOver open={open} onClose={() => onOpenChange(false)} side="left" size={320} ariaLabel="Navigation">
      {/* `hz-touch-target` raises every control in the drawer to a ≥44px tap target
          on phones/tablets (see globals.css); the desktop sidebar is a separate
          mount and stays dense. */}
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
          {/* Explicit close — right-aligned INSIDE the drawer header, so it is always
              reachable on a 390px phone (backdrop/Escape still close too). */}
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
      {/* Persistent sidebar — hidden below lg (1024px), shown at lg+. */}
      <YStack
        display="none"
        $lg={{ display: 'flex' }}
        width={collapsed ? COLLAPSED_W : EXPANDED_W}
        p={collapsed ? '$2' : '$3.5'}
        gap="$2.5"
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

          {/* Hamburger — opens the RIGHT nav drawer. Shown only below lg; ≥44×44
              touch target (WCAG 2.5.5). Hidden at lg+, so no desktop impact. */}
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

          {/* Spacer — pushes the right-side controls to the edge at lg+. On phones
              it must NOT compete with the search box for width (two flex:1 siblings
              halved the box, truncating the placeholder to “S…”), so it only flexes
              at lg+; below lg the search box fills the row. */}
          <XStack display="none" $lg={{ display: 'flex' }} flex={1} />

          {/* Full topbar controls — shown only at lg+. The org switcher now lives in
              the sidebar identity block (user → org); the topbar keeps the project
              scope switcher, theme, docs, and notifications. */}
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
          // Full-width divider; the breadcrumb content aligns to the same centered
          // max-width column as the page body (tidy on big-desktop, no drift).
          <XStack borderBottomWidth={1} borderColor="$borderColor" justify="center" px="$3" $md={{ px: '$4' }} $xl={{ px: '$6' }}>
            <XStack width="100%" maxW={CONTENT_MAX} py="$2.5">
              <Breadcrumbs />
            </XStack>
          </XStack>
        ) : null}

        {/* Content — a centered, capped column so wide desktops read comfortably
            (generous gutters, not stretched full-bleed) while narrow viewports use
            the full width. Padding + section rhythm scale up at xl. */}
        <ScrollView flex={1}>
          <XStack justify="center" px="$3" $md={{ px: '$4' }} $xl={{ px: '$6' }}>
            <YStack testID="product-content" width="100%" maxW={CONTENT_MAX} pt="$3" pb={80} $md={{ pt: '$4' }} $xl={{ pt: '$5', gap: '$5' }} gap="$4">
              {children}
              <ProductUpstreamNote pathname={pathname} />
            </YStack>
          </XStack>
        </ScrollView>
      </YStack>

      {/* Mobile account drawer — org/scope switching, notifications, theme, docs,
          sign-out. The SAME SlideOver primitive as the nav drawer (DRY, smooth). */}
      <SlideOver open={menuOpen} onClose={() => setMenuOpen(false)} side="right" size={320} title="Account">
        <YStack gap="$2">
          <XStack items="center" justify="space-between">
            <Text fontSize="$2" color="$color10">
              Theme
            </Text>
            <ThemeToggle />
          </XStack>
          <OrgSwitcher />
          <Button
            justify="flex-start"
            icon={<LayoutGrid size={16} />}
            onPress={() => {
              setMenuOpen(false)
              leaveOrg()
            }}
          >
            All organizations
          </Button>
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
