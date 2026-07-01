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
import { useRouter } from 'next/navigation'
import { Dialog, Input, ScrollView, Text, VisuallyHidden, XStack, YStack } from '@hanzo/gui'
import { Lock, Search } from '@hanzogui/lucide-icons-2'

import { visibleCatalogByCategory, type CatalogEntry } from '~/lib/products/registry'
import { searchCatalog } from '~/lib/products/search'
import { useProductColors } from '~/lib/products/pins'
import { asColor } from '~/components/ui/color'
import { openProduct } from '~/lib/products/open'
import { useIsGlobalAdmin } from '~/lib/auth/admin'

type LauncherApi = { isOpen: boolean; open: () => void; close: () => void }

const Ctx = createContext<LauncherApi | null>(null)

export function useAppLauncher(): LauncherApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppLauncher must be used within <AppLauncherProvider>')
  return ctx
}

function Tile({ entry, color, onPress }: { entry: CatalogEntry; color: string; onPress: () => void }) {
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
      {entry.status === 'soon' ? (
        <YStack px="$1.5" py={1} rounded="$10" bg="$color4" position="absolute" b="$2">
          <Text fontSize={8} fontWeight="800" letterSpacing={0.5} color="$color11">
            SOON
          </Text>
        </YStack>
      ) : null}
    </YStack>
  )
}

function LauncherDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter()
  const showAdmin = useIsGlobalAdmin()
  const { colorOf } = useProductColors()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => visibleCatalogByCategory(showAdmin), [showAdmin])
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
        <Dialog.Overlay key="launcher-overlay" bg="rgba(0,0,0,0.6)" />
        <Dialog.Content
          key="launcher-content"
          bordered
          elevate
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
                      <Tile key={entry.id} entry={entry} color={colorOf(entry.id)} onPress={() => activate(entry)} />
                    ))}
                  </XStack>
                )
              ) : (
                groups.map((group) => (
                  <YStack key={group.category} gap="$2">
                    <Text fontSize="$2" color="$color10" fontWeight="800" textTransform="uppercase" px="$2">
                      {group.category}
                    </Text>
                    <XStack flexWrap="wrap" gap="$2">
                      {group.entries.map((entry) => (
                        <Tile key={entry.id} entry={entry} color={colorOf(entry.id)} onPress={() => activate(entry)} />
                      ))}
                    </XStack>
                  </YStack>
                ))
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
