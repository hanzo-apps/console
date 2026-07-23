'use client'

/**
 * AI chat — one assistant surface, TWO shapes (the user picks, and it persists):
 *
 *  - FLOATING (default): a bubble fixed bottom-right on every dashboard page; tap it
 *    to open a compact popover (desktop) or a full-screen sheet (phone/tablet). The
 *    assistant is one tap away from any view.
 *  - DOCKED-RIGHT: a PERMANENT right-hand column (desktop/laptop) that reserves its
 *    own space beside the content — a classic docked panel. Toggle floating ⇄ docked
 *    from either header. The docked column is rendered by `Dashboard`
 *    (`DockedChatPanel`), which reserves the layout width; this module owns the
 *    dock STATE (persisted per-user via `usePreferences` under `chatDocked`) + the
 *    floating bubble/sheet.
 *
 * Docking is a desktop concern (a phone has no room for a permanent column), so on
 * `<lg` the assistant is ALWAYS the floating bubble/sheet regardless of the dock
 * choice; `docked` only reserves the right column at `lg+`.
 *
 * Every shape REUSES the one working chat surface (`ChatConversation` → `AiApi.chat`
 * → the keyless `/ai` proxy → /v1/chat/completions). Nothing about AI is rebuilt
 * here; this is purely the container. "History" deep-links to the full `/chat` page.
 *
 * Mounted once in the dashboard layout, so a single instance serves all children.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Dialog, Text, VisuallyHidden, XStack, YStack } from '@hanzo/gui'
import { PanelRight, PanelRightClose, Sparkles, X } from '@hanzogui/lucide-icons-2'

import { ChatConversation } from '~/components/products/chat/ChatConversation'
import { BrandMark } from '~/components/ui/BrandLogo'
import { usePreferences } from '~/lib/products/preferences'

type FloatingChatApi = {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  /** True when the assistant is docked as a permanent right column (persisted). */
  docked: boolean
  setDocked: (v: boolean) => void
}

const Ctx = createContext<FloatingChatApi | null>(null)

/** Open/close/dock the assistant from anywhere (e.g. an empty-state CTA). */
export function useFloatingChat(): FloatingChatApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFloatingChat must be used within <Chat>')
  return ctx
}

/** The shared assistant header — title + (dock/undock) + a trailing control. */
function AssistantHeader({
  onDockToggle,
  docked,
  trailing,
}: {
  onDockToggle: () => void
  docked: boolean
  trailing?: ReactNode
}) {
  return (
    <XStack
      items="center"
      justify="space-between"
      px="$3"
      py="$2.5"
      borderBottomWidth={1}
      borderColor="$borderColor"
      bg="$color2"
    >
      <XStack items="center" gap="$2" minW={0}>
        <Sparkles size={16} opacity={0.8} />
        <Text fontSize="$4" fontWeight="700" color="$color12" numberOfLines={1}>
          Assistant
        </Text>
      </XStack>
      <XStack items="center" gap="$1">
        <Button
          size="$2"
          chromeless
          icon={docked ? <PanelRightClose size={17} /> : <PanelRight size={17} />}
          onPress={onDockToggle}
          aria-label={docked ? 'Undock — float the assistant' : 'Dock the assistant to the right'}
        />
        {trailing}
      </XStack>
    </XStack>
  )
}

function ChatSheet({
  open,
  onOpenChange,
  onHistory,
  onDock,
  docked,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onHistory: () => void
  onDock: () => void
  /** When docked (desktop), the permanent column is the surface — so the floating
   *  sheet is suppressed at lg+ (it still serves phones, which have no column). */
  docked: boolean
}) {
  // Size is CSS-driven (media props), not a JS branch: base = mobile full-bleed
  // sheet; `$lg` = a compact popover pinned bottom-right. The scrim dims the page
  // on mobile and goes transparent on desktop (popover, no full-screen dim).
  return (
    <Dialog modal open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          key="chat-overlay"
          className="hz-scrim-in"
          bg="rgba(0,0,0,0.5)"
          $lg={{ bg: 'transparent', display: docked ? 'none' : undefined }}
        />
        <Dialog.Content
          key="chat-content"
          className="hz-paper hz-pop-in"
          bordered
          position="absolute"
          bg="$color1"
          overflow="hidden"
          p="$0"
          // Mobile/tablet: full-bleed.
          t={0}
          l={0}
          r={0}
          b={0}
          width="100vw"
          height="100dvh"
          rounded="$0"
          // Desktop (≥lg): a compact popover bottom-right, above the bubble. Docked →
          // hidden at lg+ (the permanent right column replaces it).
          $lg={{
            t: 'auto',
            l: 'auto',
            b: 88,
            r: 24,
            width: 380,
            height: 560,
            rounded: '$6',
            display: docked ? 'none' : undefined,
          }}
        >
          <VisuallyHidden>
            <Dialog.Title>Assistant</Dialog.Title>
          </VisuallyHidden>

          <YStack flex={1} minH={0}>
            <AssistantHeader
              docked={false}
              onDockToggle={onDock}
              trailing={
                <Button
                  size="$2"
                  chromeless
                  minW={44}
                  minH={44}
                  $lg={{ minW: 0, minH: 0 }}
                  icon={<X size={18} />}
                  onPress={() => onOpenChange(false)}
                  aria-label="Close assistant"
                />
              }
            />

            {/* The ONE working conversation, given a flex container to fill. */}
            <YStack flex={1} minH={0} p="$3">
              <ChatConversation compact onShowHistory={onHistory} />
            </YStack>
          </YStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

/**
 * The DOCKED assistant — a permanent right column. Rendered by `Dashboard`
 * inside the layout's reserved right rail (lg+ only), so it reserves space beside
 * the content instead of floating over it. Undock returns to the floating bubble.
 */
export function DockedChatPanel() {
  const router = useRouter()
  const { setDocked } = useFloatingChat()
  const onHistory = useCallback(() => router.push('/chat'), [router])
  return (
    <YStack flex={1} minH={0} bg="$color1">
      <AssistantHeader docked onDockToggle={() => setDocked(false)} />
      <YStack flex={1} minH={0} p="$3">
        <ChatConversation compact onShowHistory={onHistory} />
      </YStack>
    </YStack>
  )
}

export function Chat({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const { get, set } = usePreferences()
  const docked = get<boolean>('chatDocked', false)
  const setDocked = useCallback((v: boolean) => set('chatDocked', v), [set])
  // The bubble is redundant — and OVERLAPS the composer's send control — on the
  // pages that ARE a full chat/composer surface. Suppress it there (the assistant
  // is still openable programmatically via `useFloatingChat`); every other page
  // keeps the one-tap bubble.
  const onChatSurface =
    pathname === '/chat' ||
    pathname.startsWith('/chat/') ||
    pathname === '/playground' ||
    pathname.startsWith('/playground/')
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])

  const onHistory = useCallback(() => {
    setIsOpen(false)
    router.push('/chat')
  }, [router])

  // Dock from the floating sheet: reserve the desktop column + close the popover.
  const dock = useCallback(() => {
    setDocked(true)
    setIsOpen(false)
  }, [setDocked])

  return (
    <Ctx.Provider value={{ isOpen, open, close, toggle, docked, setDocked }}>
      {children}

      {/* The bubble — fixed bottom-right over every page. Hidden while open (the
          sheet's own close is the single dismiss). Hidden on the chat/playground
          surfaces (would overlap the page composer). At lg+ it is ALSO hidden when
          docked (the permanent column is the surface); on phones it always shows,
          since docking has no room there. */}
      {!isOpen && !onChatSurface ? (
        <YStack position="fixed" b={24} r={24} $lg={{ display: docked ? 'none' : 'flex' }}>
          {/* The support/AI bubble = the brand 'H' mark (white-labeled per brand),
              on Material paper elevation with a gentle hover lift. */}
          <Button
            circular
            size="$6"
            bg="$color5"
            className="hz-lift hz-elevation-3"
            hoverStyle={{ bg: '$color6' }}
            pressStyle={{ bg: '$color7' }}
            icon={<BrandMark size={22} />}
            onPress={open}
            aria-label="Open AI assistant"
          />
        </YStack>
      ) : null}

      {/* The floating sheet. On desktop it's hidden while docked (the column is the
          surface); on phones it's the assistant even when docked. */}
      <ChatSheet open={isOpen} onOpenChange={setIsOpen} onHistory={onHistory} onDock={dock} docked={docked} />
    </Ctx.Provider>
  )
}
