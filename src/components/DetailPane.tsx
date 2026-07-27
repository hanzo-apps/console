'use client'

/**
 * DetailPane — the ONE reusable right-side pane for viewing / editing the details
 * of an item, anywhere in the console. A product does NOT build its own pane: it
 * writes a DESCRIPTOR (`{ title, subtitle?, icon?, content, footer? }`) and calls
 * `useDetailPane().open(descriptor)`. The pane slides out smoothly from the right
 * (full-screen on mobile) via the shared `SlideOver`, so every "open item detail"
 * looks and behaves identically (DRY).
 *
 * Rendered ONCE at the shell root (via `DetailPane`), so any module — a
 * machine row, a provider, a pinned product's customize form — opens the same
 * pane. Interactive content closes itself with `useDetailPane().close()`.
 *
 * The last descriptor stays mounted through the close transition, so the exit
 * animates with its content (no flash of empty pane). Opening a new descriptor
 * replaces it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Button, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { X } from '@hanzogui/lucide-icons-2'

import { SlideOver } from '~/components/ui/SlideOver'
import { asColor, type IconLike } from '~/components/ui/color'
import { Z } from '~/lib/z'

export type DetailDescriptor = {
  /** Pane title (the item's name). */
  title: ReactNode
  /** Optional secondary line under the title (type, id, status…). */
  subtitle?: ReactNode
  /** Optional title icon, tinted with `iconColor`. */
  icon?: IconLike
  iconColor?: string
  /** Desktop pane width (px). Mobile is always full-screen. Default 460. */
  size?: number
  /** The body — the detail view or edit form for the item. */
  content: ReactNode
  /** Optional sticky footer (primary actions), pinned below the scroll body. */
  footer?: ReactNode
}

export type DetailPaneApi = {
  open: (descriptor: DetailDescriptor) => void
  close: () => void
  isOpen: boolean
}

const Ctx = createContext<DetailPaneApi | null>(null)

export function useDetailPane(): DetailPaneApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDetailPane must be used within <DetailPane>')
  return ctx
}

export function DetailPane({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [desc, setDesc] = useState<DetailDescriptor | null>(null)

  const open = useCallback((descriptor: DetailDescriptor) => {
    setDesc(descriptor)
    setIsOpen(true)
  }, [])
  const close = useCallback(() => setIsOpen(false), [])

  const api = useMemo<DetailPaneApi>(() => ({ open, close, isOpen }), [open, close, isOpen])
  const Icon = desc?.icon

  return (
    <Ctx.Provider value={api}>
      {children}
      <SlideOver
        open={isOpen}
        onClose={close}
        side="right"
        size={desc?.size ?? 460}
        ariaLabel={typeof desc?.title === 'string' ? desc?.title : 'Details'}
        zIndex={Z.popover}
      >
        {/* Bare-mode layout: fixed header · scroll body · optional sticky footer. */}
        <XStack items="center" gap="$2.5" px="$4" height={56} borderBottomWidth={1} borderColor="$borderColor">
          {Icon ? <Icon size={18} color={desc?.iconColor ? asColor(desc.iconColor) : undefined} /> : null}
          <YStack flex={1} minW={0}>
            <Text fontSize="$5" fontWeight="700" color="$color12" numberOfLines={1}>
              {desc?.title}
            </Text>
            {desc?.subtitle !== undefined ? (
              <Text fontSize="$2" color="$color10" numberOfLines={1}>
                {desc?.subtitle}
              </Text>
            ) : null}
          </YStack>
          <Button size="$2" chromeless icon={<X size={18} />} onPress={close} aria-label="Close" />
        </XStack>

        <ScrollView flex={1} minH={0}>
          <YStack p="$4" gap="$3">
            {desc?.content}
          </YStack>
        </ScrollView>

        {desc?.footer !== undefined ? (
          <XStack px="$4" py="$3" gap="$2" borderTopWidth={1} borderColor="$borderColor" bg="$color1">
            {desc?.footer}
          </XStack>
        ) : null}
      </SlideOver>
    </Ctx.Provider>
  )
}
