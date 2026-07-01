'use client'

/**
 * ModelPicker — the composer's model chip + a provider→model CASCADE popover over
 * the REAL catalog (375 models). You pick the PROVIDER first (Zen, OpenAI,
 * Anthropic, Google, …) in the left rail, then the MODEL in the right pane — each
 * model row carries its real context badge, $/Mtok input price and a live dot.
 *
 * Searchable (filters models across every provider, empty providers drop out) and
 * fully keyboard-navigable: ↑/↓ walk the models (rolling across providers), the
 * rail tracks the highlighted provider, ↵ selects, Esc closes. A hand-typed id
 * that isn't in the catalog still works (the free-text "Use …" row), so a model
 * can always be chosen even before the catalog loads.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, Input, Popover, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronDown, Check, Search, Boxes, ChevronRight } from '@hanzogui/lucide-icons-2'

import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { fmtContext, fmtPrice } from '~/lib/api/aicatalog'
import { providerGroups, filterGroups } from './providers'
import type { ModelOption } from './useModels'

function ContextBadge({ context }: { context: number | null }) {
  if (context == null) return null
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$10" bg="$color3" color="$color11" numberOfLines={1}>
      {fmtContext(context)} context
    </Text>
  )
}

export function ModelPicker({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string
  options: ModelOption[]
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [activeProvider, setActiveProvider] = useState<string | null>(null)
  const [hi, setHi] = useState(0)

  const current = options.find((o) => o.id === value)

  const groups = useMemo(() => providerGroups(options), [options])
  const visible = useMemo(() => filterGroups(groups, q), [groups, q])

  // One flat sequence of (provider, model) across the visible groups — the unit
  // ↑/↓ walks, so arrowing past a provider's last model rolls to the next.
  const flat = useMemo(
    () => visible.flatMap((g) => g.models.map((model) => ({ provider: g.provider, model }))),
    [visible],
  )

  const clampedHi = Math.min(hi, Math.max(0, flat.length - 1))
  const highlighted = flat[clampedHi]
  const shownProvider = activeProvider ?? highlighted?.provider ?? visible[0]?.provider ?? null
  const shownGroup = visible.find((g) => g.provider === shownProvider) ?? visible[0] ?? null
  const shownModels = shownGroup?.models ?? []

  // Seed the open popover on the current model's provider + row.
  useEffect(() => {
    if (!open) return
    setQ('')
    const idx = flatIndexOfValue(options, value)
    setHi(idx >= 0 ? idx : 0)
    setActiveProvider(groupOfValue(options, value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep the highlighted row scrolled into view as it moves.
  useEffect(() => {
    if (!open || !highlighted) return
    const i = shownModels.findIndex((m) => m.id === highlighted.model.id)
    if (i >= 0) document.getElementById(`${uid}-m-${i}`)?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedHi, shownProvider, open])

  const pick = (id: string): void => {
    if (!id.trim()) return
    onChange(id.trim())
    setOpen(false)
    setQ('')
  }

  const moveHi = (delta: number): void => {
    if (flat.length === 0) return
    const next = Math.min(Math.max(clampedHi + delta, 0), flat.length - 1)
    setHi(next)
    setActiveProvider(flat[next]?.provider ?? null)
  }

  // Keyboard nav: a capture-phase keydown handler (so arrows/Enter/Esc act on the
  // list, not the focused search input) via a ref, so it always sees fresh state.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      moveHi(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      moveHi(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (highlighted) pick(highlighted.model.id)
      else if (q.trim()) pick(q.trim())
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }
  useEffect(() => {
    if (!open) return
    const fn = (e: KeyboardEvent): void => keyRef.current(e)
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  }, [open])

  const selectProvider = (provider: string): void => {
    setActiveProvider(provider)
    const idx = flat.findIndex((f) => f.provider === provider)
    if (idx >= 0) setHi(idx)
  }

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-start">
      <Popover.Trigger asChild>
        <Button
          size="$3"
          disabled={disabled}
          borderWidth={1}
          borderColor="$borderColor"
          bg="$color2"
          px="$2.5"
          maxW="100%"
          iconAfter={<ChevronDown size={16} opacity={0.6} />}
        >
          <XStack gap="$2" items="center" flex={1} minW={0}>
            {current || value ? (
              <ProviderLogo provider={current?.provider ?? 'Other'} size={22} />
            ) : (
              <Boxes size={18} color="$color10" />
            )}
            <Text fontSize="$4" fontWeight="700" color={current || value ? '$color12' : '$color10'} numberOfLines={1}>
              {current?.name || value || 'Select a model'}
            </Text>
            <ContextBadge context={current?.context ?? null} />
          </XStack>
        </Button>
      </Popover.Trigger>
      <Popover.Content bordered elevate p="$0" width={580} maxW="92vw" bg="$color2" borderColor="$borderColor">
        <YStack width="100%">
          {/* Search */}
          <XStack p="$2" borderBottomWidth={1} borderColor="$borderColor" items="center" gap="$2">
            <Search size={15} color="$color10" />
            <Input
              flex={1}
              size="$3"
              value={q}
              onChangeText={(v: string) => {
                setQ(v)
                setHi(0)
                setActiveProvider(null)
              }}
              placeholder={`Search ${options.length || 375} models…`}
              autoCapitalize="none"
              borderWidth={0}
              bg="transparent"
            />
          </XStack>

          {flat.length === 0 ? (
            <YStack p="$3" gap="$2" minH={120}>
              <Text fontSize="$2" color="$color10">
                {options.length === 0
                  ? 'The model catalog loads with your session. You can still type a model id to use it now.'
                  : `No models match “${q}”.`}
              </Text>
              {q.trim() ? (
                <XStack
                  items="center"
                  gap="$2"
                  px="$2.5"
                  py="$2"
                  rounded="$3"
                  cursor="pointer"
                  hoverStyle={{ bg: '$color4' }}
                  onPress={() => pick(q.trim())}
                >
                  <ProviderLogo provider="Other" size={22} />
                  <Text fontSize="$3" color="$color12" flex={1} numberOfLines={1}>
                    Use “{q.trim()}”
                  </Text>
                  <Check size={14} />
                </XStack>
              ) : null}
            </YStack>
          ) : (
            <XStack minH={300} maxH={380}>
              {/* Provider rail */}
              <ScrollView width={172} borderRightWidth={1} borderColor="$borderColor" showsVerticalScrollIndicator={false}>
                <YStack p="$1.5" gap="$0.5">
                  {visible.map((g) => {
                    const active = g.provider === shownProvider
                    return (
                      <XStack
                        key={g.provider}
                        items="center"
                        gap="$2"
                        px="$2"
                        py="$2"
                        rounded="$3"
                        cursor="pointer"
                        bg={active ? '$color4' : 'transparent'}
                        hoverStyle={{ bg: active ? '$color4' : '$color3' }}
                        onPress={() => selectProvider(g.provider)}
                      >
                        <ProviderLogo provider={g.provider} size={20} />
                        <Text fontSize="$2" color="$color12" numberOfLines={1} flex={1}>
                          {g.provider}
                        </Text>
                        <Text fontSize="$1" color="$color9">
                          {g.models.length}
                        </Text>
                        {active ? <ChevronRight size={13} color="$color10" /> : null}
                      </XStack>
                    )
                  })}
                </YStack>
              </ScrollView>

              {/* Model pane */}
              <ScrollView flex={1} showsVerticalScrollIndicator={false}>
                <YStack p="$1.5" gap="$0.5">
                  {shownModels.map((o, i) => {
                    const isHi = highlighted?.model.id === o.id
                    const isSel = o.id === value
                    return (
                      <XStack
                        key={o.id}
                        id={`${uid}-m-${i}`}
                        items="center"
                        gap="$2.5"
                        px="$2.5"
                        py="$2"
                        rounded="$3"
                        cursor="pointer"
                        hoverStyle={{ bg: '$color4' }}
                        bg={isHi ? '$color4' : isSel ? '$color3' : 'transparent'}
                        onPress={() => pick(o.id)}
                      >
                        <ProviderLogo provider={o.provider} size={22} />
                        <YStack flex={1} gap={1} minW={0}>
                          <XStack items="center" gap="$2">
                            <Text fontSize="$3" color="$color12" numberOfLines={1}>
                              {o.name}
                            </Text>
                            {o.available ? (
                              <Text fontSize="$1" color="$green11">
                                ● live
                              </Text>
                            ) : null}
                          </XStack>
                          <XStack items="center" gap="$2" flexWrap="wrap">
                            <ContextBadge context={o.context} />
                            <Text fontSize="$1" color="$color10">
                              {fmtPrice(o.inputPrice)}/M in
                            </Text>
                          </XStack>
                        </YStack>
                        <XStack width={16} items="center" justify="center">
                          {isSel ? <Check size={14} /> : null}
                        </XStack>
                      </XStack>
                    )
                  })}
                </YStack>
              </ScrollView>
            </XStack>
          )}
        </YStack>
      </Popover.Content>
    </Popover>
  )
}

/** The flat index (across Zen-first provider groups) of the currently-set id, or -1. */
function flatIndexOfValue(options: ModelOption[], value: string): number {
  if (!value) return -1
  let idx = 0
  for (const g of providerGroups(options)) {
    for (const m of g.models) {
      if (m.id === value) return idx
      idx++
    }
  }
  return -1
}

/** The provider group name that holds the current id, or null. */
function groupOfValue(options: ModelOption[], value: string): string | null {
  for (const g of providerGroups(options)) {
    if (g.models.some((m) => m.id === value)) return g.provider
  }
  return null
}
