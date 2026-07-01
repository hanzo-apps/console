'use client'

/**
 * SettingsSheet — the mobile presentation of the Model settings.
 *
 * On phones the settings side-pane is hidden (CSS) and this bottom sheet takes its
 * place: the SAME `ModelSettings` controls slid up from the bottom, dismissable.
 * It reuses the shell's `Dialog modal` drawer pattern (overlay + absolute Content)
 * so behaviour and theming match the rest of the console; the trigger that opens
 * it is itself CSS-hidden on desktop, so the sheet can only ever open on mobile.
 */
import type { ReactNode } from 'react'
import { Button, Dialog, ScrollView, Text, VisuallyHidden, XStack } from '@hanzo/gui'
import { X } from '@hanzogui/lucide-icons-2'

export function SettingsSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  children: ReactNode
}) {
  return (
    <Dialog modal open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay key="settings-overlay" bg="rgba(0,0,0,0.55)" />
        <Dialog.Content
          key="settings-content"
          bordered
          elevate
          position="absolute"
          b={0}
          l={0}
          r={0}
          maxH="85dvh"
          p="$4"
          gap="$3"
          bg="$color1"
          borderTopLeftRadius="$6"
          borderTopRightRadius="$6"
          borderBottomLeftRadius="$0"
          borderBottomRightRadius="$0"
        >
          <VisuallyHidden>
            <Dialog.Title>Model settings</Dialog.Title>
          </VisuallyHidden>
          <XStack items="center" justify="space-between">
            <Text fontSize="$5" fontWeight="800" color="$color12">
              Model settings
            </Text>
            <Button size="$2" chromeless icon={<X size={18} />} onPress={() => onOpenChange(false)} aria-label="Close settings" />
          </XStack>
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
