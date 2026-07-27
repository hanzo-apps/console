'use client'

/**
 * The `?` cheatsheet — every hotkey that is LIVE right now, grouped by section.
 *
 * It reads the hotkey registry rather than a hand-kept list, so it can never drift
 * from what the keyboard actually does: a module that mounts adds its rows, a module
 * that unmounts removes them. It owns its own `?` binding and its own open state
 * (mounted once, beside the other app-shell overlays).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Dialog, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { Keyboard } from '@hanzogui/lucide-icons-2'

import { useHotkeyRegistry, useHotkeys, type Hotkey } from '~/lib/hooks/useHotkeys'
import { Keys } from './Kbd'

/** Group the live hotkeys, first-seen order, preserving order inside each group. */
function sections(all: Hotkey[]): { group: string; rows: Hotkey[] }[] {
  const out = new Map<string, Hotkey[]>()
  for (const h of all) {
    const rows = out.get(h.group)
    if (rows) rows.push(h)
    else out.set(h.group, [h])
  }
  return [...out].map(([group, rows]) => ({ group, rows }))
}

export function ShortcutHelp({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const all = useHotkeyRegistry()
  useHotkeys(
    useMemo<Hotkey[]>(
      () => [{ keys: '?', label: 'Keyboard shortcuts', group: 'General', run: () => setOpen((v) => !v) }],
      [],
    ),
  )
  const groups = useMemo(() => sections(all), [all])

  return (
    <>
      {children}
      <Dialog modal open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay key="shortcuts-overlay" className="hz-scrim-in" bg="rgba(0,0,0,0.5)" />
          <Dialog.Content
            key="shortcuts-content"
            className="hz-paper hz-pop-in"
            bordered
            width="100vw"
            height="100dvh"
            maxW="100vw"
            rounded="$0"
            $lg={{ width: 560, height: 'auto', maxW: '90%', rounded: '$6' }}
            p="$0"
            gap="$0"
            overflow="hidden"
          >
            <XStack items="center" gap="$2.5" px="$4" py="$3" borderBottomWidth={1} borderColor="$borderColor">
              <Keyboard size={17} opacity={0.7} />
              <Dialog.Title fontSize="$5" fontWeight="700" color="$color12">
                Keyboard shortcuts
              </Dialog.Title>
              <XStack flex={1} />
              <Text fontSize="$1" color="$color10">
                esc
              </Text>
            </XStack>

            {/* Fills the viewport on mobile; a bounded, scrollable box at lg+ — the
                same shape as the palette body, so the two overlays read as one family. */}
            <YStack flex={1} minH={0} overflow="hidden" $lg={{ flex: 0, maxH: 560 }}>
              <ScrollView flex={1} p="$4" showsVerticalScrollIndicator>
                {groups.length === 0 ? (
                  <Text fontSize="$3" color="$color10">
                    No shortcuts are active on this screen.
                  </Text>
                ) : (
                  <YStack gap="$4">
                    {groups.map(({ group, rows }) => (
                      <YStack key={group} gap="$1.5">
                        <Text fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
                          {group}
                        </Text>
                        {rows.map((h) => (
                          <XStack key={`${group}:${h.keys}:${h.label}`} items="center" gap="$3" py="$1">
                            <Text flex={1} fontSize="$3" color="$color12">
                              {h.label}
                            </Text>
                            <Keys keys={h.keys} />
                          </XStack>
                        ))}
                      </YStack>
                    ))}
                  </YStack>
                )}
              </ScrollView>
            </YStack>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </>
  )
}
