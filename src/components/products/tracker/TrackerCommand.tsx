'use client'

/**
 * Tracker command palette — a focused quick-switcher over the tracker's own actions +
 * navigation + issues. In the STANDALONE tracker shell (tracker.<brand>) it owns ⌘K
 * via a capture-phase listener that stops the event before the console's global
 * palette sees it, so each shell has exactly one ⌘K owner (the embedded /tracker view
 * defers to the global palette instead — the module only mounts this when
 * `config.shell === 'tracker'`). Type to filter commands + jump straight to an issue
 * by identifier or title; ↑/↓ to move, Enter to run, Esc to close.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Input, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import type { ComponentType } from 'react'

export type Command = {
  id: string
  label: string
  hint?: string
  group: string
  icon?: ComponentType<{ size?: number }>
  run: () => void
}

export function TrackerCommand({
  open,
  onClose,
  commands,
}: {
  open: boolean
  onClose: () => void
  commands: Command[]
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      // focus after mount
      const t = setTimeout(() => inputRef.current?.focus(), 10)
      return () => clearTimeout(t)
    }
  }, [open])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((c) => `${c.label} ${c.hint ?? ''} ${c.group}`.toLowerCase().includes(needle))
  }, [q, commands])

  useEffect(() => {
    if (active >= filtered.length) setActive(0)
  }, [filtered.length, active])

  const run = (c?: Command) => {
    if (!c) return
    onClose()
    c.run()
  }

  // Arrow/Enter/Escape on a document listener (Tamagui Input doesn't reliably forward
  // onKeyDown); capture phase so it wins while the palette is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        run(filtered[active])
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered, active])

  if (!open) return null

  // Group order preserved as first-seen.
  const groups: { name: string; items: Command[] }[] = []
  for (const c of filtered) {
    let g = groups.find((x) => x.name === c.group)
    if (!g) groups.push((g = { name: c.group, items: [] }))
    g.items.push(c)
  }
  let idx = -1

  return (
    <YStack position="fixed" t={0} l={0} r={0} b={0} items="center" style={{ zIndex: 2000 }} pt="$10">
      {/* Backdrop as its own layer BEHIND the card — a card click never bubbles to it. */}
      <YStack
        position="absolute"
        t={0}
        l={0}
        r={0}
        b={0}
        style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
        onPress={onClose}
      />
      <YStack
        width="92%"
        maxW={620}
        bg="$color1"
        borderWidth={1}
        borderColor="$borderColor"
        rounded="$5"
        overflow="hidden"
        className="hz-elevation-4"
      >
        <XStack items="center" gap="$2" px="$3" height={48} borderBottomWidth={1} borderColor="$borderColor">
          <Text fontSize="$4" color="$color9">
            ⌘
          </Text>
          <Input
            ref={inputRef as never}
            flex={1}
            unstyled
            value={q}
            onChangeText={setQ}
            placeholder="Type a command or jump to an issue…"
            fontSize="$4"
            color="$color12"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text fontSize="$1" color="$color9">
            Esc
          </Text>
        </XStack>
        <ScrollView maxH={420}>
          <YStack py="$1.5">
            {groups.length === 0 ? (
              <Text fontSize="$2" color="$color9" px="$3" py="$3">
                No matching commands.
              </Text>
            ) : (
              groups.map((g) => (
                <YStack key={g.name} pb="$1">
                  <Text px="$3" py="$1" fontSize="$1" color="$color9" fontWeight="700" textTransform="uppercase" letterSpacing={0.4}>
                    {g.name}
                  </Text>
                  {g.items.map((c) => {
                    idx += 1
                    const on = idx === active
                    const Icon = c.icon
                    return (
                      <XStack
                        key={c.id}
                        items="center"
                        gap="$2.5"
                        px="$3"
                        height={38}
                        bg={on ? '$color4' : 'transparent'}
                        hoverStyle={{ bg: '$color3' }}
                        cursor="pointer"
                        onPress={() => run(c)}
                      >
                        {Icon ? (
                          <Text color="$color10">
                            <Icon size={15} />
                          </Text>
                        ) : (
                          <YStack width={15} />
                        )}
                        <Text flex={1} fontSize="$3" color="$color12" numberOfLines={1}>
                          {c.label}
                        </Text>
                        {c.hint ? (
                          <Text fontSize="$1" color="$color9" className="hz-mono" numberOfLines={1}>
                            {c.hint}
                          </Text>
                        ) : null}
                      </XStack>
                    )
                  })}
                </YStack>
              ))
            )}
          </YStack>
        </ScrollView>
      </YStack>
    </YStack>
  )
}
