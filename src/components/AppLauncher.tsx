'use client'

/**
 * App launcher — a fullscreen, Launchpad-style grid of every product, with a
 * live filter. Opened from the header affordance and from the command palette.
 *
 * Renders entirely from the catalog registry (DRY): with no query it groups by
 * the canonical categories; while filtering it shows a flat ranked grid (the same
 * `searchCatalog` scorer the palette uses). A tile opens the product the one way
 * (`openProduct` — in-console route or external tab) and closes the launcher.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Dialog, Input, ScrollView, Text, VisuallyHidden, XStack, YStack } from '@hanzo/gui'
import { AppWindow, Bot, CreditCard, LayoutGrid, Lock, MessageCircle, Search, Sparkles, Users } from '@hanzogui/lucide-icons-2'
import { otherSurfaces, type Surface, type SurfaceId } from '@hanzo/ui/product'

import { getBrand } from '~/lib/branding/brands'
import { findEntry, visibleCatalogByCategory, type CatalogEntry } from '~/lib/products/registry'
import { orderEntries } from '~/lib/products/order'
import { searchCatalog } from '~/lib/products/search'
import { useProductColors } from '~/lib/products/pins'
import { asColor } from '@hanzo/ui/product'
import { openProduct } from '~/lib/products/open'
import { useIsSuperAdmin } from '~/lib/auth/admin'

/**
 * Cross-surface tiles — the shared app switcher's entries that live OUTSIDE this
 * console: every Hanzo surface but the console itself (this IS the console), from
 * the ONE canonical `SURFACES` list. Hanzo brand only (white-label law: a lux/zoo/
 * pars host never shows a Hanzo surface — gated by `getBrand().id` at render).
 */
const CROSS_SURFACES: Surface[] = otherSurfaces('console')
const SURFACE_ICONS = {
  ai: Sparkles,
  console: LayoutGrid,
  app: AppWindow,
  chat: MessageCircle,
  bot: Bot,
  team: Users,
  billing: CreditCard,
} as const satisfies Record<SurfaceId, unknown>

type LauncherApi = { isOpen: boolean; open: () => void; close: () => void }

const Ctx = createContext<LauncherApi | null>(null)

export function useAppLauncher(): LauncherApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppLauncher must be used within <AppLauncherProvider>')
  return ctx
}

function Tile({ entry, color, active, onPress }: { entry: CatalogEntry; color: string; active?: boolean; onPress: () => void }) {
  const Icon = entry.icon
  return (
    <YStack
      onPress={onPress}
      cursor="pointer"
      width={132}
      height={124}
      p="$3"
      gap="$2.5"
      items="center"
      justify="center"
      rounded="$6"
      bg={active ? '$color3' : 'transparent'}
      borderWidth={1}
      borderColor={active ? '$color6' : 'transparent'}
      hoverStyle={{ bg: '$color3' }}
    >
      <XStack
        width={56}
        height={56}
        items="center"
        justify="center"
        rounded="$7"
        position="relative"
        style={{ backgroundColor: `${color}22` }}
      >
        <Icon size={26} color={asColor(color)} />
        {entry.admin ? (
          <XStack position="absolute" t={-4} r={-4} bg="$color2" rounded="$10" p="$1">
            <Lock size={11} opacity={0.7} />
          </XStack>
        ) : null}
      </XStack>
      <Text fontSize="$2" fontWeight="600" color="$color12" numberOfLines={1}>
        {entry.label}
      </Text>
    </YStack>
  )
}

/** A launcher tile for a cross-surface entry (opens in a new tab). */
function SurfaceTile({ surface, onPress }: { surface: Surface; onPress: () => void }) {
  const Icon = SURFACE_ICONS[surface.id]
  return (
    <YStack
      onPress={onPress}
      cursor="pointer"
      width={132}
      height={124}
      p="$3"
      gap="$2.5"
      items="center"
      justify="center"
      rounded="$6"
      borderWidth={1}
      borderColor="transparent"
      hoverStyle={{ bg: '$color3' }}
    >
      <XStack width={56} height={56} items="center" justify="center" rounded="$7" bg="$color3">
        <Icon size={26} />
      </XStack>
      <Text fontSize="$2" fontWeight="600" color="$color12" numberOfLines={1}>
        {surface.label}
      </Text>
      <Text fontSize="$1" color="$color10" numberOfLines={1}>
        {surface.hint}
      </Text>
    </YStack>
  )
}

function LauncherDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const showAdmin = useIsSuperAdmin()
  const { colorOf } = useProductColors()
  const [query, setQuery] = useState('')

  // The active product (from the current route) — pinned first + emphasized in the
  // browse grid, per directive #58 §2.2.
  const activeId = useMemo(() => {
    const seg = pathname.split('/').filter(Boolean)[0]
    return seg ? (findEntry(seg)?.id ?? null) : null
  }, [pathname])

  // Browse (no query): each category's apps are CONTINUOUS ALPHABETICAL with the
  // selected app pinned first — the SAME `orderEntries` rule the sidebar uses (DRY).
  // The launcher is the "browse ALL apps" surface — DISCOVERY, decoupled from
  // entitlement. It shows the WHOLE catalog (admin-gated only), NOT the org's enabled
  // scope: entitlement governs the SIDEBAR (your workspace nav = what you use) and is
  // enforced when you OPEN a product (its page shows the honest "enable for your org"
  // state), never by hiding a product from the directory. So a user always sees every
  // product Hanzo offers here — `enabled` is deliberately NOT passed.
  const groups = useMemo(
    () =>
      visibleCatalogByCategory(showAdmin, null).map((g) => ({
        category: g.category,
        entries: orderEntries(g.entries, activeId),
      })),
    [showAdmin, activeId],
  )
  // While filtering, keep the relevance ranking (a search is not alphabetical). Gate
  // by admin ONLY — the full catalog is searchable (discovery, not entitlement scope).
  const filtered = useMemo(
    () => (query.trim() ? searchCatalog(query).filter((e) => showAdmin || !e.admin) : null),
    [query, showAdmin],
  )

  const activate = useCallback(
    (entry: CatalogEntry) => {
      onOpenChange(false)
      openProduct(entry, (p) => router.push(p))
    },
    [onOpenChange, router],
  )

  return (
    <Dialog modal open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay key="launcher-overlay" className="hz-scrim-in" bg="rgba(0,0,0,0.6)" />
        <Dialog.Content
          key="launcher-content"
          className="hz-paper hz-pop-in"
          bordered
          width="92vw"
          height="88vh"
          maxW={1180}
          p="$0"
          gap="$0"
          overflow="hidden"
        >
          <VisuallyHidden>
            <Dialog.Title>All products</Dialog.Title>
          </VisuallyHidden>

          {/* Search row */}
          <XStack
            items="center"
            gap="$2.5"
            px="$4"
            py="$3.5"
            borderBottomWidth={1}
            borderColor="$borderColor"
          >
            <Search size={18} opacity={0.7} />
            <Input
              flex={1}
              unstyled
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Filter products…"
              fontSize="$5"
              color="$color12"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text fontSize="$1" color="$color10">
              esc
            </Text>
          </XStack>

          {/* Grid */}
          <ScrollView flex={1}>
            <YStack p="$4" gap="$5">
              {filtered ? (
                filtered.length === 0 ? (
                  <YStack p="$8" items="center">
                    <Text color="$color10">No products match “{query.trim()}”.</Text>
                  </YStack>
                ) : (
                  <XStack flexWrap="wrap" gap="$2">
                    {filtered.map((entry) => (
                      <Tile key={entry.id} entry={entry} color={colorOf(entry.id)} active={entry.id === activeId} onPress={() => activate(entry)} />
                    ))}
                  </XStack>
                )
              ) : (
                <>
                  {groups.map((group) => (
                    <YStack key={group.category} gap="$2">
                      <Text fontSize="$2" color="$color10" fontWeight="800" textTransform="uppercase" px="$2">
                        {group.category}
                      </Text>
                      <XStack flexWrap="wrap" gap="$2">
                        {group.entries.map((entry) => (
                          <Tile key={entry.id} entry={entry} color={colorOf(entry.id)} active={entry.id === activeId} onPress={() => activate(entry)} />
                        ))}
                      </XStack>
                    </YStack>
                  ))}
                  {getBrand().id === 'hanzo' ? (
                    <YStack gap="$2">
                      <Text fontSize="$2" color="$color10" fontWeight="800" textTransform="uppercase" px="$2">
                        Surfaces
                      </Text>
                      <XStack flexWrap="wrap" gap="$2">
                        {CROSS_SURFACES.map((s) => (
                          <SurfaceTile
                            key={s.id}
                            surface={s}
                            onPress={() => {
                              onOpenChange(false)
                              if (typeof window !== 'undefined') window.open(s.href, '_blank', 'noopener')
                            }}
                          />
                        ))}
                      </XStack>
                    </YStack>
                  ) : null}
                </>
              )}
            </YStack>
          </ScrollView>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export function AppLauncherProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  return (
    <Ctx.Provider value={{ isOpen, open, close }}>
      {children}
      <LauncherDialog open={isOpen} onOpenChange={setIsOpen} />
    </Ctx.Provider>
  )
}
