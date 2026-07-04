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
 *   opens the SAME two-level nav as a RIGHT-side drawer (with ⌘K search + Apps at
 *   the top); the topbar condenses into a right-side account drawer.
 *
 * Off-canvas surfaces (nav drawer, account menu, item DetailPane) all ride the
 * ONE `SlideOver` primitive — transform-driven, so enter AND exit animate
 * smoothly (reduced-motion aware). Layout responsiveness stays CSS-driven
 * (`display="none"` + `$lg={{…}}`), NOT a JS media branch, so SSR and first paint
 * match (no hydration flash). The nav body (`SidebarNav`) is shared by the
 * persistent sidebar and the drawer (DRY) — one definition, two mounts.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Input, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpen,
  ChevronRight,
  Circle,
  CircleHelp,
  Command,
  CreditCard,
  ExternalLink,
  House,
  LayoutGrid,
  Lock,
  LogOut,
  Menu,
  PanelLeft,
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
import { openProduct } from '~/lib/products/open'
import { entryMatches } from '~/lib/products/search'
import { usePins, useProductColors } from '~/lib/products/pins'
import { categoryIsOpen, toggleCategory, NAV_OPEN_PREF, EMPTY_OPEN, type CategoryOpen } from '~/lib/products/nav-accordion'
import { usePreferences } from '~/lib/products/preferences'
import { useSession } from '~/lib/auth/session'
import { useIsGlobalAdmin } from '~/lib/auth/admin'
import { useAccent } from '~/lib/theme/accent'
import { SidebarWallet } from '~/components/SidebarWallet'
import { CommandSearchBox, useCommandPalette } from '~/components/CommandPalette'
import { useAppLauncher } from '~/components/AppLauncher'
import { useDetailPane } from '~/components/DetailPane'
import { ProductCustomize, ManagePins } from '~/components/SidebarCustomize'
import { SlideOver } from '~/components/ui/SlideOver'
import { asColor } from '~/components/ui/color'
import { ProductIcon } from '~/components/ui/ProductIcon'
import { ThemeToggle } from '~/components/ui/ThemeToggle'
import { Breadcrumbs } from '~/components/ui/Breadcrumbs'
import { BrandLogo } from '~/components/ui/BrandLogo'
import { OrgSwitcher } from '~/components/OrgSwitcher'
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

/** Inline accent-bar style for the ACTIVE nav item when a custom org accent is set — a
 *  left bar in the org's color (keeps the product glyph + label legible; no forced
 *  background/text). Default monochrome (undefined) when no accent. */
const accentBarStyle = (active: boolean, accent: string | null): { boxShadow: string } | undefined =>
  active && accent ? { boxShadow: `inset 3px 0 0 0 ${accent}` } : undefined

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
  const { accent } = useAccent()
  return (
    <Button
      onPress={onPress}
      bg={active ? '$color4' : 'transparent'}
      style={accentBarStyle(!!active, accent)}
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
  const { accent } = useAccent()
  if (collapsed) {
    return (
      <Button
        onPress={onOpen}
        bg={active ? '$color4' : 'transparent'}
        style={accentBarStyle(active, accent)}
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
        style={accentBarStyle(active, accent)}
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

/** Level 2 — the open product's sub-nav: a CATEGORY breadcrumb (back + sibling
 *  jumps), the product header, its sub-pages, and "More in <category>". */
function Level2Nav({
  entry,
  color,
  colorOf,
  pathname,
  showAdmin,
  onBack,
  onGo,
}: {
  entry: CatalogEntry
  color: string
  colorOf: (id: string) => string
  pathname: string
  showAdmin: boolean
  onBack: () => void
  onGo: (path: string) => void
}) {
  const Icon = entry.icon
  const subs = productSubpages(entry, showAdmin)
  const activeSlug = activeSubpageSlug(pathname, entry.id)
  const siblings = useMemo(() => {
    const group = visibleCatalogByCategory(showAdmin).find((g) => g.category === entry.category)
    return (group?.entries ?? []).filter((e) => e.id !== entry.id)
  }, [entry.category, entry.id, showAdmin])

  return (
    <>
      {/* Category breadcrumb — the "where am I?" context; the chip jumps back to
          the product list, so the category is always one tap away. */}
      <XStack items="center" gap="$1" height={30}>
        <Button size="$2" chromeless icon={<ArrowLeft size={18} />} onPress={onBack} aria-label="Back to products" />
        <XStack onPress={onBack} cursor="pointer" items="center" hoverStyle={{ opacity: 0.7 }}>
          <Text fontSize="$1" color="$color10" fontWeight="800" textTransform="uppercase" letterSpacing={0.4}>
            {entry.category}
          </Text>
        </XStack>
      </XStack>
      <XStack items="center" gap="$2" px="$1.5" mb="$1" height={30} minW={0}>
        <ProductIcon icon={Icon} color={color} size={22} />
        <Text fontSize="$4" fontWeight="800" color="$color12" numberOfLines={1}>
          {entry.label}
        </Text>
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

          {/* Category links — jump to sibling products without leaving the level-2
              context; keeps the category navigable, never a dead end. */}
          {siblings.length > 0 ? (
            <YStack gap="$1" mt="$3" pt="$2" borderTopWidth={1} borderColor="$borderColor">
              <XStack
                px="$2"
                items="center"
                justify="space-between"
                cursor="pointer"
                hoverStyle={{ opacity: 0.7 }}
                onPress={() => onGo(`/category/${categorySlug(entry.category)}`)}
                aria-label={`${entry.category} overview`}
              >
                <Text fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
                  More in {entry.category}
                </Text>
                <ChevronRight size={11} opacity={0.4} />
              </XStack>
              {siblings.map((s) => {
                const SibIcon = s.icon
                return (
                  <Button
                    key={s.id}
                    onPress={() => openProduct(s, onGo)}
                    justify="flex-start"
                    chromeless
                    icon={<SibIcon size={16} color={asColor(colorOf(s.id))} />}
                    size="$3"
                    opacity={0.9}
                  >
                    {s.label}
                  </Button>
                )
              })}
            </YStack>
          ) : null}
        </YStack>
      </ScrollView>
    </>
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
  const showAdmin = useIsGlobalAdmin()
  const [filter, setFilter] = useState('')

  // Collapsible-category accordion state — the user's explicit per-category open
  // choices, persisted per-user (account-backed + localStorage cache) so a
  // reload/navigation keeps them. The active route's category stays open (see
  // `categoryIsOpen`), so the current page is always visible.
  const prefs = usePreferences()
  const navOpen = prefs.get<CategoryOpen>(NAV_OPEN_PREF, EMPTY_OPEN)
  const activeCat = activeCategory(pathname)
  const toggleSection = (category: string) => prefs.set(NAV_OPEN_PREF, toggleCategory(navOpen, category))

  // The open product's sub-nav (level 2) FOLLOWS the route.
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

  const go = (path: string) => {
    router.push(path)
    onNavigate()
  }
  const open = (entry: CatalogEntry) => {
    // An external launch tile opens its deployed app in a new tab (no route, no
    // sub-nav to expand) — the ONE opener handles the kind; close the drawer after.
    if (entry.kind === 'external') {
      openProduct(entry, go)
      onNavigate()
      return
    }
    setFilter('')
    setOpenId(entry.id)
    router.push(`/${entry.id}`)
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

  const openEntry = openId ? findEntry(openId) : undefined
  const q = (collapsed ? '' : filter).trim().toLowerCase()
  const filtering = q.length > 0
  // Level 2 (the open product's sub-nav) yields to the product list while the user
  // is filtering, so a query typed from ANY level surfaces the list to jump across.
  const showLevel2 =
    !collapsed && !filtering && Boolean(openEntry && openEntry.kind === 'module' && (showAdmin || !openEntry.admin))

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

  const groups = useMemo(
    () =>
      visibleCatalogByCategory(showAdmin)
        .map((g) => ({ category: g.category, entries: g.entries.filter((e) => entryMatches(e, q)) }))
        .filter((g) => g.entries.length > 0),
    [q, showAdmin],
  )

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

  // ── Collapsed icon rail — products as colored icons; expand for sub-nav ──
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

  // ── Expanded: constant H-mark header + two-level slide + wallet footer ──
  return (
    <>
      <XStack items="center" height={36} mb="$1">
        <Button flex={1} chromeless justify="flex-start" px="$1" onPress={() => go('/')} aria-label="Overview">
          <BrandLogo size={22} wordmark={false} />
        </Button>
      </XStack>

      {/* Product filter — a PERSISTENT header above the two-level slide, so a user
          deep in a product (level 2) can filter + jump straight to another product
          without going Back. Typing surfaces the (level-1) list from any level. */}
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
          <ScrollView flex={1}>
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
              color={colorOf(openEntry.id)}
              colorOf={colorOf}
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

/** Mobile/tablet nav drawer — the same SidebarNav, slid in from the RIGHT, with a
 *  ⌘K search + Apps launcher at the top (the command surface, reachable on mobile). */
function NavDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const palette = useCommandPalette()
  const launcher = useAppLauncher()
  return (
    <SlideOver open={open} onClose={() => onOpenChange(false)} side="right" size={320} ariaLabel="Navigation">
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

          {/* Full topbar controls — shown only at lg+. */}
          <XStack display="none" $lg={{ display: 'flex' }} items="center" gap="$2">
            <ThemeToggle />
            <Button size="$2" chromeless icon={<CircleHelp size={16} />} onPress={openDocs} aria-label="Documentation" />
            <Button size="$2" chromeless icon={<Bell size={16} />} onPress={() => push('/alerts')} aria-label="Notifications" />
            <OrgSwitcher />
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
            <YStack testID="product-content" width="100%" maxW={CONTENT_MAX} py="$3" $md={{ py: '$4' }} $xl={{ py: '$5', gap: '$5' }} gap="$4">
              {children}
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
