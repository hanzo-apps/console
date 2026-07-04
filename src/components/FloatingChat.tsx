'use client'

/**
 * Floating AI chat — a bubble fixed bottom-right on every dashboard page, so the
 * assistant is one tap away from any view (the "where's chat on mobile" ask).
 *
 * It REUSES the one working chat surface (`ChatConversation` → `AiApi.chat` → the
 * keyless `/ai` proxy → /v1/chat/completions). Nothing about AI is rebuilt here;
 * this is purely a container that mounts that conversation in an overlay:
 * - phone/tablet (<1024px): a full-screen sheet.
 * - laptop/desktop: a ~380×560 popover anchored bottom-right.
 *
 * "History" inside the conversation deep-links to the full `/chat` page (the
 * bubble is a quick-ask surface, not the session browser) and closes the bubble.
 *
 * Mounted once in the dashboard layout (like the app launcher), so a single
 * instance floats over all children — lightweight, no per-page wiring.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Dialog, Text, VisuallyHidden, XStack, YStack } from '@hanzo/gui'
import { Sparkles, X } from '@hanzogui/lucide-icons-2'

import { ChatConversation } from '~/components/products/chat/ChatConversation'
import { BrandMark } from '~/components/ui/BrandLogo'

type FloatingChatApi = { isOpen: boolean; open: () => void; close: () => void; toggle: () => void }

const Ctx = createContext<FloatingChatApi | null>(null)

/** Open/close the floating assistant from anywhere (e.g. an empty-state CTA). */
export function useFloatingChat(): FloatingChatApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFloatingChat must be used within <FloatingChatProvider>')
  return ctx
}

function ChatSheet({
  open,
  onOpenChange,
  onHistory,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onHistory: () => void
}) {
  // Size is CSS-driven (media props), not a JS branch: base = mobile full-bleed
  // sheet; `$lg` = a compact popover pinned bottom-right. The scrim dims the page
  // on mobile and goes transparent on desktop (popover, no full-screen dim).
  return (
    <Dialog modal open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay key="chat-overlay" className="hz-scrim-in" bg="rgba(0,0,0,0.5)" $lg={{ bg: 'transparent' }} />
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
          // Desktop (≥lg): a compact popover bottom-right, above the bubble.
          $lg={{
            t: 'auto',
            l: 'auto',
            b: 88,
            r: 24,
            width: 380,
            height: 560,
            rounded: '$6',
          }}
        >
          <VisuallyHidden>
            <Dialog.Title>Assistant</Dialog.Title>
          </VisuallyHidden>

          <YStack flex={1} minH={0}>
            <XStack
              items="center"
              justify="space-between"
              px="$3"
              py="$2.5"
              borderBottomWidth={1}
              borderColor="$borderColor"
              bg="$color2"
            >
              <XStack items="center" gap="$2">
                <Sparkles size={16} opacity={0.8} />
                <Text fontSize="$4" fontWeight="700" color="$color12">
                  Assistant
                </Text>
              </XStack>
              <Button
                size="$2"
                chromeless
                icon={<X size={18} />}
                onPress={() => onOpenChange(false)}
                aria-label="Close assistant"
              />
            </XStack>

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

export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
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

  return (
    <Ctx.Provider value={{ isOpen, open, close, toggle }}>
      {children}

      {/* The bubble — fixed bottom-right over every page (rendered last in this
          provider so DOM order keeps it above normal-flow content; the chat sheet
          portals above it). Hidden while open so the sheet's own close control is
          the single dismiss affordance. Hidden on the chat/playground surfaces,
          where it would overlap the page's own composer. */}
      {!isOpen && !onChatSurface ? (
        <YStack position="fixed" b={24} r={24}>
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

      <ChatSheet open={isOpen} onOpenChange={setIsOpen} onHistory={onHistory} />
    </Ctx.Provider>
  )
}
