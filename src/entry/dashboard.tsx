'use client'

/**
 * Dashboard shell — a TWO-LEVEL sidebar + top bar + content, responsive across
 * phone / tablet / laptop / desktop.
 *
 * ONE LEVEL SHOWS AT A TIME, and the ROUTE picks which:
 *
 * Level 1 (anywhere outside a product) is the catalog: fixed Overview/Docs, a
 * Pinned section the user curates, then every product grouped by category. Each
 * CATEGORY is an INDEPENDENTLY collapsible section that renders EXPANDED by default
 * (nothing auto-collapses); the header is flush-left with the top-level items and
 * carries an OPTIONAL collapse chevron whose state persists per-user.
 *
 * Level 2 (inside a product) is that product's pages — Overview + specifics + the
 * uniform base set (Settings · Status · Logs · Metrics) — sitting FLUSH where the
 * catalog was, under the category you came through, with the rest of that category
 * beneath them so a sibling stays one click away. A page with no backend yet is
 * dimmed and opens an honest placeholder, never a dead link.
 *
 * Both halves of that used to be true at once: the pages appeared INDENTED under the
 * product's row while the whole catalog stayed painted below, so two levels shared
 * the screen and a pinned product carried its pages in one place while its own
 * category row sat inert in another — the same product twice, one of them dead. The
 * level is a REPLACEMENT now, which is the only reading of "level" that stays true
 * when the list is long.
 *
 * Level 2 is DECLARED once, in the registry (`subpages` + `indexLabel`), and read
 * here and by `SubNav` (the same nav, for the viewports where this sidebar is a
 * drawer). No module carries its own tab list. The level itself is carried by the
 * URL and nothing else, so a reload, a deep link and Back all agree — there is no
 * remembered expansion to disagree with them.
 *
 * The WHOLE sidebar collapses to an icon RAIL (the topbar panel toggle, persisted).
 * When collapsed, HOVER reveals the full sidebar as an OVERLAY flyout (it doesn't
 * push the content) — the classic rail + flyout. On phones the sidebar is a LEFT
 * drawer (hamburger) instead; the collapse/rail is a desktop concern.
 *
 * The assistant is opened from its OWN floating control bottom-right (`FloatingChat`),
 * never from this topbar; all this shell owns about it is `column`, which reserves the
 * PERMANENT right column when the assistant is that column.
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
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from 'react'
import { usePathname } from 'next/navigation'
import { useRouter } from '~/lib/router'
import { Button, Input, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import {
  BarChart3,
  Bell,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleHelp,
  Command,
  CreditCard,
  ExternalLink,
  House,
  LayoutGrid,
  Lock,
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
  visibleCatalog,
  visibleCatalogByCategory,
  findEntry,
  categorySlug,
  type CatalogEntry,
  type NavSection,
  type ProductSubpage,
} from '~/lib/products/registry'
import { productSubpages, subpageWired, activeSubpage } from '~/lib/products/match'
import { subpageIcon } from '~/components/ui/SubNav'
import { ProductGuidePanel } from '~/components/guide/ProductGuidePanel'
import { ConsoleFooter } from '~/components/ConsoleFooter'
import { openProduct } from '~/lib/products/open'
import { entryMatches } from '~/lib/products/search'
import { usePins, useProductColors } from '~/lib/products/pins'
import { orderEntries } from '~/lib/products/order'
import {
  categoryIsOpen,
  toggleCategory,
  NAV_OPEN_PREF,
  NAV_CATALOG_PREF,
  EMPTY_OPEN,
  type CategoryOpen,
} from '~/lib/products/nav'
import { usePreferences } from '~/lib/products/preferences'
import { useViewer } from '~/lib/products/viewer'
import { listed, stageOf } from '~/lib/products/stage'
import { useEntitlements } from '~/lib/entitlements-context'
import { ALWAYS_ON_PRODUCTS, isAlwaysOn } from '~/lib/entitlements'
import { AddProductPanel } from '~/components/AddProductPanel'
import { SidebarWallet } from '~/components/SidebarWallet'
import { CommandSearchBox, useCommandPalette } from '~/components/CommandPalette'
import { useDetailPane } from '~/components/DetailPane'
import { ProductCustomize, ManagePins } from '~/components/SidebarCustomize'
import { SlideOver } from '~/components/ui/SlideOver'
import { ProductIcon } from '~/components/ui/ProductIcon'
import { SystemStatusBadge } from '~/components/ui/SystemStatusBadge'
import { Breadcrumbs } from '~/components/ui/Breadcrumbs'
import { SidebarBrand } from '~/components/SidebarBrand'
import { AccountMenu } from '~/components/AccountMenu'
import { BrandMark } from '~/components/ui/BrandLogo'
import { shellFor, isProductShell } from '~/lib/products/shell'
import { HanzoAppLauncher } from '@hanzogui/shell'
import { ScopeSwitcher } from '~/components/ScopeSwitcher'
import { ContextSwitcher } from '~/components/ContextSwitcher'
import { useFloatingChat, DockedChatPanel } from '~/components/FloatingChat'
import { WorkbenchDock } from '~/components/workbench/Workbench'
import { Z } from '~/lib/z'

const EXPANDED_W = 264
const COLLAPSED_W = 64
/** Docked-assistant right column width (lg+ only). */
const DOCK_W = 384
/** Content column cap — wide desktops read comfortably (generous gutters) instead of
 *  stretching full-bleed; narrower viewports fall back to full width. */
const CONTENT_MAX = 1680
/** Collapsed-rail icon size — large enough to be a comfortable hit target. */
const ICON = 20

/** The active in-console module id for a path, or null (home / external / unknown). */
function activeModuleId(pathname: string): string | null {
  const seg = pathname.split('/').filter(Boolean)[0]
  if (!seg) return null
  const e = findEntry(seg)
  return e && e.kind === 'module' ? e.id : null
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

/** A fixed (non-catalog) sidebar link: Overview, Docs. Memoized: the rail
 *  re-renders on every navigation (usePathname), but a row only changes when its
 *  own visible state does. The handler is stable in meaning for a given row, so
 *  the comparator ignores its identity and re-renders on the visible props alone. */
const FixedRow = memo(function FixedRow({
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
}, (a, b) =>
  a.icon === b.icon && a.label === b.label && a.active === b.active && a.external === b.external && a.collapsed === b.collapsed)

/** A level-1 catalog row — colored product icon, opens the product; trailing is an
 *  expansion chevron (products with sub-pages) then a pin star (catalog rows) or a
 *  color/customize dot (pinned rows). Memoized on its visible props — see FixedRow. */
const NavRow = memo(function NavRow({
  entry,
  active,
  color,
  collapsed,
  pinned,
  expandable,
  expanded,
  onExpand,
  onOpen,
  onToggle,
  onCustomize,
}: {
  entry: CatalogEntry
  active: boolean
  color: string
  collapsed: boolean
  pinned?: boolean
  /** True when the product has sub-pages to expand beneath it. */
  expandable?: boolean
  expanded?: boolean
  onExpand?: () => void
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
  const hint = stageOf(entry) === 'admin' ? (
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
      {/* Expansion is its OWN control, separate from the row: the label navigates,
          the chevron only opens or closes. One target that did both would make
          "show me what's in here" and "take me there" the same gesture. */}
      {expandable && onExpand ? (
        <Button
          size="$2"
          chromeless
          onPress={onExpand}
          aria-expanded={expanded}
          aria-controls={`nav-sub-${entry.id}`}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${entry.label}`}
          icon={
            <span
              className="hz-chevron"
              style={{ display: 'inline-flex', transform: expanded ? 'rotate(90deg)' : undefined }}
            >
              <ChevronRight size={14} color="$color9" />
            </span>
          }
        />
      ) : null}
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
}, (a, b) =>
  a.entry === b.entry && a.active === b.active && a.color === b.color && a.collapsed === b.collapsed &&
  a.pinned === b.pinned && a.expandable === b.expandable && a.expanded === b.expanded)

/**
 * ONE level-2 row — a single page of the product the rail is currently showing.
 *
 * Level 2 is a REPLACEMENT, not a nesting: when a product is open the rail lists
 * ITS pages, so these rows sit FLUSH with the level-1 rows they stand in for. They
 * used to be indented under the product's row while the whole catalog stayed
 * painted below, which put two levels on screen at once and left the reader to work
 * out which list they were in.
 *
 * An unwired page is dimmed but honest — it opens a placeholder, never a dead link.
 * Both faces render through this one row: the full console's level 2 and the
 * product-shell face, whose nav IS its root module's pages.
 *
 * Memoized on its visible props — see FixedRow.
 */
const SubRow = memo(function SubRow({
  id,
  sub,
  active,
  collapsed,
  onGo,
}: {
  id: string
  sub: ProductSubpage
  active: boolean
  collapsed: boolean
  onGo: (path: string) => void
}) {
  const wired = subpageWired(id, sub.slug)
  const Icon = sub.icon ?? subpageIcon(sub.slug)
  return (
    <Button
      onPress={() => onGo(sub.slug ? `/${id}/${sub.slug}` : `/${id}`)}
      bg={active ? '$color4' : 'transparent'}
      justify={collapsed ? 'center' : 'flex-start'}
      px={collapsed ? '$0' : '$2.5'}
      height={collapsed ? 44 : undefined}
      icon={<Icon size={collapsed ? ICON : 17} />}
      iconAfter={!collapsed && !wired ? <Circle size={7} opacity={0.5} /> : undefined}
      size="$3"
      opacity={wired ? 1 : 0.6}
      aria-current={active ? 'page' : undefined}
      aria-label={wired ? sub.label : `${sub.label} (not available yet)`}
    >
      {collapsed ? undefined : sub.label}
    </Button>
  )
}, (a, b) =>
  a.id === b.id && a.sub === b.sub && a.active === b.active && a.collapsed === b.collapsed)

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
  category: NavSection
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
          <Text flex={1} fontSize="$1" color="$color10" fontWeight="500">
            {category}
          </Text>
          <Text fontSize="$1" fontWeight="700" color="$color9">
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

/**
 * Sidebar account — the ONE account control, at the FOOT of the rail: who you are,
 * which organization you are acting in, the balance, the theme, and the way out.
 *
 * There used to be three of these — an org switcher at the top, an account popover
 * at the bottom, and a third menu in the mobile drawer, each with its own sign-out.
 * They are now one `AccountMenu` (`@hanzo/iam`'s `UserMenu`), mounted here and in
 * the drawer, so identity and tenancy are never two places to look. Reused by the
 * desktop sidebar, the collapsed rail, the flyout, AND the mobile drawer.
 */
function SidebarAccount({ collapsed }: { collapsed: boolean }) {
  return (
    <YStack
      gap="$1.5"
      pt="$2"
      mt="$1"
      items={collapsed ? 'center' : undefined}
      borderTopWidth={1}
      borderColor="$borderColor"
    >
      <AccountMenu />
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
  const viewer = useViewer()
  // Entitlement scope: currently ungated in prod (the endpoint 404s → `enabled` is
  // null → the full catalog shows), matching "every product is always available".
  const { enabled } = useEntitlements()

  // Collapsible-category accordion state — the user's EXPLICIT per-category collapse
  // choices, persisted per-user. Everything is EXPANDED by default; a collapsed
  // section stays collapsed where the user left it (see `categoryIsOpen`).
  const prefs = usePreferences()
  const navOpen = prefs.get<CategoryOpen>(NAV_OPEN_PREF, EMPTY_OPEN)
  const toggleSection = (category: string) => prefs.set(NAV_OPEN_PREF, toggleCategory(navOpen, category))
  // Does the rail list the whole catalog, or only what you keep? (Profile → Account.)
  const catalogInRail = prefs.get<boolean>(NAV_CATALOG_PREF, true)

  // ── Which level the rail is on ────────────────────────────────────────────
  // The ROUTE decides, and nothing else: inside a product the rail shows THAT
  // product's pages plus the rest of its category (level 2); anywhere else it shows
  // the catalog (level 1). One level on screen at a time, and a reload, a deep link
  // and Back all land on the same rail because none of it is remembered state.
  const activeId = activeModuleId(pathname)
  const isActive = (id: string) => pathname === `/${id}` || pathname.startsWith(`/${id}/`)

  // Navigate to a LEAF (a sub-page or a no-sub-page product) — closes the drawer.
  const go = (path: string) => {
    router.push(path)
    onNavigate()
  }
  // Open a product from the list. One with pages keeps the drawer open, because the
  // rail is about to become that product's pages and they are the next thing to
  // read; a leaf navigates and closes. An external tile opens its app in a new tab.
  const open = (entry: CatalogEntry) => {
    if (entry.kind === 'external') {
      openProduct(entry, go)
      onNavigate()
      return
    }
    if (productSubpages(entry, viewer).length > 1) {
      router.push(`/${entry.id}`) // the rail becomes its pages
    } else {
      go(`/${entry.id}`) // leaf — navigate + close
    }
  }

  /** ONE product row. Pinned rows carry the customize dot, catalog rows the pin star. */
  const productRow = (entry: CatalogEntry, opts: { pinned?: boolean } = {}) => (
    <NavRow
      key={`${opts.pinned ? 'pin' : 'cat'}-${entry.id}`}
      entry={entry}
      active={isActive(entry.id)}
      color={colorOf(entry.id)}
      collapsed={false}
      pinned={opts.pinned ?? isPinned(entry.id)}
      onOpen={() => open(entry)}
      onToggle={opts.pinned ? undefined : () => toggle(entry.id)}
      onCustomize={opts.pinned ? () => customize(entry) : undefined}
    />
  )
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

  // Grouped pins, gated so a customer never sees an admin-only surface.
  const pinnedGroups = useMemo(
    () =>
      view
        .map((g) => ({
          ...g,
          entries: g.entries.filter((e) => {
            const found = findEntry(e.id)
            return Boolean(found) && listed(stageOf(found!), viewer)
          }),
        }))
        .filter((g) => g.entries.length > 0),
    [view, viewer],
  )

  // Within-scope ordering is CONTINUOUS ALPHABETICAL with the SELECTED product pinned
  // first — via the ONE shared `orderEntries` helper. Categories stay in their
  // canonical order; only the items inside each are alphabetized + selected-first.
  //
  // "Show every product" opens the ENTITLEMENT scope, exactly as the All-products
  // panel already does: every product is available to every org on demand, so what
  // an org has ENABLED is a statement about use, not about permission. Off, the rail
  // narrows to that enabled set. PERMISSION — admin surfaces, brand scope — holds
  // either way, so nothing on the rail is ever a surface the viewer cannot open.
  const groups = useMemo(
    () =>
      visibleCatalogByCategory(viewer, catalogInRail ? null : enabled)
        .map((g) => ({ category: g.category, entries: orderEntries(g.entries, activeId) }))
        .filter((g) => g.entries.length > 0),
    [viewer, catalogInRail, enabled, activeId],
  )

  // The essentials the rail keeps when the catalog is put away. Derived from the
  // ONE always-on list so it cannot drift from what the entitlement layer refuses
  // to gate, filtered through the SAME visibility the catalog uses — a stage or a
  // brand scope that hides a product must hide it here too, or the compact rail
  // becomes a way to reach something the full one does not offer.
  const essentials = useMemo(() => {
    const visible = new Map(visibleCatalog(viewer, null).map((e) => [e.id, e]))
    return ALWAYS_ON_PRODUCTS.map((id) => visible.get(id)).filter(
      (e): e is NonNullable<typeof e> => Boolean(e) && !isPinned(e!.id),
    )
  }, [viewer, isPinned])

  // ── Level 2 — the product the route is inside ─────────────────────────────
  // Its pages become the rail, and the rest of its category follows them, so moving
  // to a sibling stays one click.
  const level = activeId ? findEntry(activeId) : undefined
  // A product with no pages of its own is a LEAF: there is no second level to show,
  // so the rail stays on the catalog with that row lit. Same rule `open` navigates by.
  const here =
    level && listed(stageOf(level), viewer) && productSubpages(level, viewer).length > 1 ? level : undefined
  const siblings =
    here && catalogInRail
      ? (groups.find((g) => g.category === here.category)?.entries ?? []).filter((e) => e.id !== here.id)
      : []

  // ── Product-shell face — the nav IS the root module's sub-pages ────────────
  if (isProductShell(config.shell)) {
    const shell = shellFor(config.shell)
    const rootId = shell.rootId ?? ''
    const root = findEntry(rootId)
    const subs: ProductSubpage[] =
      root && root.kind === 'module'
        ? [{ slug: '', label: shell.indexLabel }, ...(root.subpages ?? []).filter((s) => listed(stageOf(s), viewer))]
        : []
    const activeSlug = root ? activeSubpage(pathname, root.id) : ''
    return (
      // The product rail is a NAVIGATION LANDMARK. It had no role at all, so a
      // screen-reader user had no way to jump to the product list and no way to
      // skip past it. `display: contents` adds the landmark with ZERO layout
      // effect (the children keep their parent's flex context), and the explicit
      // role survives regardless of how a given AT treats display:contents.
      <nav role="navigation" aria-label="Products" style={{ display: 'contents' }}>
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
        ) : collapsed ? (
          <SidebarBrand collapsed onNavigate={onNavigate} />
        ) : null}
        <ScrollView flex={1}>
          <YStack gap="$1">
            {subs.map((sp) => (
              <SubRow
                key={sp.slug || 'overview'}
                id={rootId}
                sub={sp}
                active={sp.slug === activeSlug}
                collapsed={collapsed}
                onGo={go}
              />
            ))}
          </YStack>
        </ScrollView>
        <SidebarAccount collapsed={collapsed} />
        <SidebarWallet collapsed={collapsed} />
      </nav>
    )
  }

  // ── Collapsed icon rail — brand mark; a CURATED set (pinned + the active product);
  //    All-products; account + wallet. Hover reveals the full nav as a flyout. ──
  if (collapsed) {
    const railIds: string[] = []
    const seen = new Set<string>()
    for (const id of [...pinnedIds, ...(activeId ? [activeId] : [])]) {
      const e = findEntry(id)
      if (e && !seen.has(id) && listed(stageOf(e), viewer)) {
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
        <SidebarAccount collapsed />
        <SidebarWallet collapsed />
      </>
    )
  }

  // ── The rail: switcher; filter; Overview/Docs; then ONE level — the catalog, or
  //    the open product's pages followed by its category; All-products; identity. ──
  return (
    // The product rail is a NAVIGATION LANDMARK. It had no role at all, so a
    // screen-reader user had no way to jump to the product list and no way to
    // skip past it. `display: contents` adds the landmark with ZERO layout
    // effect (the children keep their parent's flex context), and the explicit
    // role survives regardless of how a given AT treats display:contents.
    <nav role="navigation" aria-label="Products" style={{ display: 'contents' }}>
      {/* WHERE you are — organization and project in ONE control, and the FIRST
          thing in the rail: the org's own logo (when IAM carries one) or its
          name IS the mark, so a separate brand row above it said the same thing
          twice. The account at the foot answers WHO you are; the network chip
          in the top-right is a global MODE. Three questions, three controls,
          each in one place. The collapsed icon rail keeps its mark — there is
          no switcher to carry the identity there. */}
      <ContextSwitcher />

      {/* Search — the SAME palette the header and the drawer open, so the whole
          catalog (every product AND every page inside one) is one query away from
          the rail, at either level. The rail used to carry its own text filter that
          narrowed only the rows it had already drawn: a second search, answering a
          smaller question. */}
      <XStack mb="$2">
        <CommandSearchBox />
      </XStack>

      <ScrollView flex={1} minH={0}>
        <YStack gap="$3.5">
          <YStack gap="$1">
            <FixedRow icon={House} label="Overview" active={pathname === '/'} collapsed={false} onPress={() => go('/')} />
            <FixedRow icon={BookOpen} label="Docs" external collapsed={false} onPress={openDocs} />
          </YStack>

          {here ? (
            /* LEVEL 2 — the open product's pages, flush, then the rest of its
               category. The catalog is not painted underneath: one level at a
               time, and the category row above is the way back up to it. */
            <>
              <YStack gap="$1">
                <Button
                  size="$2"
                  chromeless
                  height={32}
                  px="$2.5"
                  justify="flex-start"
                  onPress={() => go(`/category/${categorySlug(here.category)}`)}
                  icon={<ChevronLeft size={14} opacity={0.7} />}
                  aria-label={`Back to ${here.category}`}
                >
                  <Text fontSize="$1" color="$color10" fontWeight="500">
                    {here.category}
                  </Text>
                </Button>
                {/* The product names the list below it — a heading, not a link:
                    its index is the first row, and two ways to the same page is
                    the duplication this level exists to remove. */}
                <XStack items="center" gap="$2" px="$2.5" pb="$0.5">
                  <ProductIcon icon={here.icon} color={colorOf(here.id)} size={18} />
                  <Text fontSize="$3" fontWeight="700" color="$color12" numberOfLines={1}>
                    {here.label}
                  </Text>
                </XStack>
                {productSubpages(here, viewer).map((sp) => (
                  <SubRow
                    key={sp.slug || 'overview'}
                    id={here.id}
                    sub={sp}
                    active={sp.slug === activeSubpage(pathname, here.id)}
                    collapsed={false}
                    onGo={go}
                  />
                ))}
              </YStack>

              {siblings.length > 0 ? (
                <YStack gap="$1">
                  <Text px="$2.5" fontSize="$1" color="$color10" fontWeight="500">
                    More in {here.category}
                  </Text>
                  {siblings.map((entry) => productRow(entry))}
                </YStack>
              ) : null}
            </>
          ) : (
            /* LEVEL 1 — what you pinned, then every category. */
            <>
              {pinnedGroups.length > 0 ? (
                <YStack gap="$1.5">
                  <XStack items="center" justify="space-between" px="$2.5">
                    <Text fontSize="$1" color="$color10" fontWeight="500">
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
                        return productRow(entry, { pinned: true })
                      })}
                    </YStack>
                  ))}
                </YStack>
              ) : null}

              {catalogInRail ? (
                groups.map((group) => (
                  <CategorySection
                    key={group.category}
                    category={group.category}
                    count={group.entries.length}
                    open={categoryIsOpen(navOpen, group.category)}
                    onToggle={() => toggleSection(group.category)}
                  >
                    {group.entries.map((entry) => productRow(entry))}
                  </CategorySection>
                ))
              ) : (
                /* The catalog is put away, so the rail is the pins — plus the
                   essentials, plus wherever you are, which would otherwise be the
                   one place with no row.

                   THE ESSENTIALS SURVIVE IT. `ALWAYS_ON_PRODUCTS` is declared as
                   the set "without which the console is unusable — you must always
                   be able to see your home, pay, and manage your org", and putting
                   the catalog away used to drop every one of them: 152 rows became
                   9, with no Billing, Settings, Profile, Members or API Keys
                   anywhere in the rail. That reads as a console that lost its
                   account, and the only way back was to turn the catalog on again.

                   Hiding the CATALOG is what the control says it does. The set the
                   entitlement layer already refuses to gate is not part of the
                   catalog in that sense, so it is not what gets hidden. One list,
                   read here rather than restated — a second copy of "the
                   essentials" is how the two drift. */
                <YStack gap="$1">
                  {essentials.map((entry) => productRow(entry))}
                  {level && !isPinned(level.id) && !isAlwaysOn(level.id)
                    ? productRow(level)
                    : null}
                </YStack>
              )}
            </>
          )}

          {/* Browse the full catalog — pin/unpin + find what's in use. Always
              available (no enable gate; every product is always on). */}
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
        </YStack>
      </ScrollView>

      {/* Bottom-left cluster: the org switcher + account menu, then the wallet. */}
      <SidebarAccount collapsed={false} />
      <SidebarWallet collapsed={false} />
    </nav>
  )
}

/** Mobile/tablet nav drawer — the same SidebarNav, slid in from the LEFT (the
 *  hamburger is top-left and this is a left-nav), with the ⌘K search + Apps button
 *  at the top — both open the one command surface, reachable on mobile. */
function NavDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const palette = useCommandPalette()
  return (
    <SlideOver open={open} onClose={() => onOpenChange(false)} side="left" size={320} ariaLabel="Navigation">
      {/* `hz-touch-target` raises every control in the drawer to a ≥44px tap target
          on phones/tablets (see globals.css); the desktop sidebar stays dense. */}
      <YStack flex={1} minH={0} p="$3" gap="$2.5" className="hz-touch-target">
        <XStack gap="$2" items="center">
          <CommandSearchBox height={44} onOpen={() => onOpenChange(false)} />
          {/* No second "Apps" trigger here either — the search row above opens the
              very same palette, so one row is the whole affordance. */}
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

/**
 * The breadcrumb bar — a route-dependent LEAF. It owns its own `usePathname()` so the
 * route subscription lives here, not in the shell: on `/` (the overview home) it
 * renders nothing; on any product route it shows the bordered breadcrumb strip. Keeping
 * this a separate component is what lets `Dashboard` stay inert across navigation.
 */
function BreadcrumbsBar() {
  const pathname = usePathname() ?? ''
  if (pathname === '/') return null
  return (
    <XStack borderBottomWidth={1} borderColor="$borderColor" justify="center" px="$3" $md={{ px: '$4' }} $xl={{ px: '$6' }}>
      <XStack width="100%" maxW={CONTENT_MAX} py="$2.5">
        <Breadcrumbs />
      </XStack>
    </XStack>
  )
}

/**
 * The product guide panel — a route-dependent LEAF, for the same reason as
 * `BreadcrumbsBar`: it owns its own `usePathname()` so the shell never subscribes to
 * the route and stays inert across navigation.
 */
function ProductGuide() {
  const pathname = usePathname() ?? ''
  return <ProductGuidePanel pathname={pathname} />
}

/** The content column, as something that can be put back to the top. */
type Scroller = ComponentRef<typeof ScrollView>

/**
 * A new screen starts at the top.
 *
 * A document load always did this for free, and navigation is no longer a document
 * load — the address moves on the history API and the content column keeps whatever
 * offset the last screen was read at, so a product opened from halfway down the
 * previous one opens halfway down. A LEAF for the same reason `BreadcrumbsBar` is:
 * it is the only thing here that subscribes to the route, so the shell around it
 * still does not re-render on a navigation.
 */
function TopOnArrival({ content }: { content: RefObject<Scroller | null> }) {
  const pathname = usePathname() ?? ''
  useEffect(() => {
    content.current?.scrollTo({ y: 0, animated: false })
  }, [pathname, content])
  return null
}

export function Dashboard({ children }: { children: ReactNode }) {
  // NB: the shell does NOT subscribe to `usePathname()` — that is confined to the
  // leaves that actually depend on the route (`SidebarNav` for the active highlight,
  // `BreadcrumbsBar` below). So a navigation click re-renders ONLY the swapped page
  // content + those leaves; the topbar and sidebar chrome stay put (no flicker, no
  // lost scroll/state). Any shell re-render is a genuine shell interaction (collapse,
  // drawer, dock), never a route change.
  const router = useRouter()
  const { get, set } = usePreferences()
  // The assistant: `column` is the only thing the SHELL owns about it — it reserves
  // the width beside the content. Opening it belongs to the assistant's own floating
  // control (`AssistantFab`), not to this topbar.
  const { column } = useFloatingChat()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // Collapsed-rail hover flyout (desktop only): the full sidebar overlays the content
  // without pushing it, revealed while the pointer is over the rail/flyout.
  const [flyout, setFlyout] = useState(false)
  // Held here because the shell owns the scroller; read only by `TopOnArrival`, so
  // holding it costs the shell no route subscription.
  const content = useRef<Scroller | null>(null)

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
              // A flyout is a menu: the ladder's dropdown rung, so the account
              // control it contains (a popover) still paints above it.
              style={{ zIndex: Z.dropdown }}
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

          {/* The search box IS the app switcher: it calls the same
              `useCommandPalette().open` the old "Apps" button called, and says so
              ("Search or jump to… ⌘K"). Two triggers for one palette, side by
              side, read as two different destinations — so there is now one. */}
          <CommandSearchBox />

          {/* The assistant is NOT here. Chat and voice live together in the one
              floating control bottom-right (`AssistantFab` in `FloatingChat`), where
              the assistant itself appears — so the topbar carries navigation and
              account chrome only, and the user's OWN brand leads it (top-left). */}

          {/* Spacer — pushes the right-side controls to the edge at lg+. Below lg the
              search box fills the row (two flex:1 siblings would halve it). */}
          <XStack display="none" $lg={{ display: 'flex' }} flex={1} />

          {/* Full topbar controls — shown only at lg+. The bar carries navigation
              only: status and docs. Theme lives in the account menu, alerts at
              /alerts, and the network picker and app launcher in the account drawer
              — production is the default environment, so the environment is chrome
              you open, not chrome you wear. */}
          <XStack display="none" $lg={{ display: 'flex' }} items="center" gap="$2">
            <SystemStatusBadge />
            <Button size="$2" chromeless icon={<CircleHelp size={16} />} onPress={openDocs} aria-label="Documentation" />
          </XStack>

          {/* Account drawer trigger — every viewport. The drawer is where the
              occasional controls live (environment, notifications, account). */}
          <Button
            size="$3"
            chromeless
            icon={<SlidersHorizontal size={18} />}
            onPress={() => setMenuOpen(true)}
            aria-label="Account and settings"
          />
        </XStack>

        <BreadcrumbsBar />

        {/* Content — a centered, capped column so wide desktops read comfortably. */}
        <ScrollView flex={1} ref={content}>
          <XStack justify="center" px="$3" $md={{ px: '$4' }} $xl={{ px: '$6' }}>
            <YStack testID="product-content" width="100%" maxW={CONTENT_MAX} pt="$3" pb={80} $md={{ pt: '$4' }} $xl={{ pt: '$5', gap: '$5' }} gap="$4">
              <TopOnArrival content={content} />
              <ProductGuide />
              {children}
              <ConsoleFooter />
            </YStack>
          </XStack>
        </ScrollView>

        {/* Developers workbench — the persistent bottom dock (Overview · Logs ·
            Shell), available on every page without leaving it. Desktop-only. */}
        <WorkbenchDock />
      </YStack>

      {/* Docked assistant — a PERMANENT right column. Reserves its own width beside
          the content; toggled from the assistant header. Rendered only when it IS the
          assistant, so a narrow viewport (where the sheet serves instead) does not
          also hold a second, invisible conversation. */}
      {column ? (
        <YStack width={DOCK_W} minW={DOCK_W} borderLeftWidth={1} borderColor="$borderColor" bg="$color1">
          <DockedChatPanel />
        </YStack>
      ) : null}

      {/* Account drawer — the SAME account control as the rail foot, so identity,
          tenancy, theme, billing and sign-out read identically everywhere. The
          occasional controls sit beside it: the environment picker (production
          is the default, switching it is a deliberate act), notifications, and the
          cross-app launcher.

          The launcher lives HERE and only here. It used to sit in the lg+ topbar
          group, which is display:none on a phone — so the grid of the other Hanzo
          apps was unreachable from the console on the viewport most likely to want
          it. This drawer's trigger is on EVERY viewport, which makes one launcher
          serve them all rather than a second copy serving the small one. */}
      <SlideOver open={menuOpen} onClose={() => setMenuOpen(false)} side="right" size={320} title="Account">
        <YStack gap="$2" className="hz-touch-target">
          <AccountMenu />
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
          {/* From the shared shell — the same launcher chat and every other Hanzo
              surface carries. ⌘K stays with the command palette; the launcher
              must not claim it too. */}
          <XStack items="center" gap="$2">
            <HanzoAppLauncher currentApp="console" align="right" quickSwitchKey={false} />
            <Text fontSize="$3" color="$color11">
              Hanzo apps
            </Text>
          </XStack>
        </YStack>
      </SlideOver>
    </XStack>
  )
}
