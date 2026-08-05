'use client'

/**
 * ModelSelector — THE one model picker across the console (Playground composer, Evals
 * run + judge, and every other "choose a model" surface). A hanzo.chat-style
 * FAMILY-GROUPED popover over the live gateway catalog: the house brands first (Enso,
 * Zen) then Anthropic, OpenAI, then every other vendor alphabetically, each under a
 * family header, monochrome marks so the list reads as ONE system. Searchable across
 * every family, keyboard-navigable (↑/↓/↵/Esc), and a hand-typed id that isn't in the
 * catalog still works (the free-text "Use …" row) so a model can always be chosen even
 * before the catalog loads.
 *
 * ONE WAY, PER REPO — and the reason there are still two is now down to ONE thing.
 * `@hanzo/ui/models` `ModelSelector` is the canonical unified selector. It is NO LONGER
 * the shadcn/Tailwind build this comment used to describe: at 8.0.56 it imports
 * @hanzo/gui and @hanzogui/lucide-icons-2, carries no Radix and no class strings, so the
 * "console runs Tamagui, that build doesn't" objection is gone. The contract already
 * matches (`{ models, value, onChange, size, chatOnly, disabled, placeholder }`).
 *
 * Two things still stand in the way, and neither is styling:
 *   1. ENTRY SHAPE. This takes `CatalogEntry` (`{ name, id?, provider?, context? |
 *      contextWindow? }`); the package takes `ModelCatalogEntry` (`{ id, owned_by?,
 *      context_window?, modality? }`). An adapter is small but it is real, and it
 *      decides family grouping, so it needs checking against `~/lib/api/families`.
 *   2. LOGOS. The rows here render `ui/ProviderLogo`, which draws curated per-family
 *      brand marks. The package's selector renders none, and the package's own
 *      ProviderLogo falls back to initials for all but two providers — the same gap
 *      that keeps ui/ProviderLogo local. Close that upstream and this file can go.
 *
 * Fed from the live catalog (`useModelCatalog` → `aicatalog.fetchCatalog`); it never
 * hardcodes a model list.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, Input, Popover, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronDown, Check, Search, Boxes } from '@hanzogui/lucide-icons-2'

import { ProviderLogo } from '~/components/ui/ProviderLogo'
import {
  modelId,
  modelDisplayName,
  modelContext,
  fmtContext,
  fmtPrice,
  type CatalogEntry,
} from '~/lib/api/aicatalog'
import { groupModelsByFamily, filterFamilies, totalModels } from '~/lib/api/families'
import { paper } from '~/components/ui/paper'

/** The contract's entry type — the rich catalog entry (`@hanzo/ui/models` `ModelCatalogEntry`). */
export type ModelCatalogEntry = CatalogEntry

function ContextBadge({ context }: { context: number | null }) {
  if (context == null) return null
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$10" bg="$color3" color="$color11" numberOfLines={1}>
      {fmtContext(context)} context
    </Text>
  )
}

/** The premium (paid-balance) chip — a calm monochrome pill, no vendor hue. */
function PremiumChip() {
  return (
    <Text fontSize="$1" px="$1.5" py={1} rounded="$4" bg="$color12" color="$color1" fontWeight="700">
      PRO
    </Text>
  )
}

export function ModelSelector({
  models,
  value,
  onChange,
  size = 'md',
  chatOnly = true,
  disabled,
  placeholder = 'Select a model',
}: {
  /** The live catalog entries (source of truth) — grouped into families internally. */
  models: CatalogEntry[]
  /** The selected model id. */
  value: string
  onChange: (id: string) => void
  /** `sm` = compact (Evals/side forms), `md` = the composer's model chip (default). */
  size?: 'sm' | 'md'
  /** Keep only current-gen chat models (the hanzo.chat set). Default true. */
  chatOnly?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)

  const allGroups = useMemo(() => groupModelsByFamily(models, { chatOnly }), [models, chatOnly])
  const total = useMemo(() => totalModels(allGroups), [allGroups])
  const visible = useMemo(() => filterFamilies(allGroups, q), [allGroups, q])

  // One flat sequence of (family, model) across the visible groups — the unit ↑/↓ walks.
  const flat = useMemo(
    () => visible.flatMap((g) => g.models.map((model) => ({ family: g, model }))),
    [visible],
  )
  const clampedHi = Math.min(hi, Math.max(0, flat.length - 1))
  const highlighted = flat[clampedHi]

  // The currently-selected entry (or the raw hand-typed id when it isn't in the catalog).
  const current = useMemo(
    () => models.find((m) => modelId(m).toLowerCase() === value.trim().toLowerCase()),
    [models, value],
  )
  const currentName = current ? modelDisplayName(current) || modelId(current) : value

  // Seed the open popover on the current model's row.
  useEffect(() => {
    if (!open) return
    setQ('')
    const idx = flatIndexOfValue(allGroups, value)
    setHi(idx >= 0 ? idx : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep the highlighted row scrolled into view as it moves.
  useEffect(() => {
    if (!open || !highlighted) return
    document.getElementById(`${uid}-r-${clampedHi}`)?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedHi, open])

  const pick = (id: string): void => {
    if (!id.trim()) return
    onChange(id.trim())
    setOpen(false)
    setQ('')
  }

  const moveHi = (delta: number): void => {
    if (flat.length === 0) return
    setHi(Math.min(Math.max(clampedHi + delta, 0), flat.length - 1))
  }

  // Capture-phase keydown (so arrows/Enter/Esc act on the list, not the search input),
  // via a ref so it always sees fresh state.
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
      if (highlighted) pick(modelId(highlighted.model))
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

  const compact = size === 'sm'
  const logoSize = compact ? 18 : 22

  // A running flat index so each row can id itself for scroll-into-view + selection.
  let rowIdx = -1

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-start">
      <Popover.Trigger asChild>
        <Button
          size={compact ? '$2' : '$3'}
          disabled={disabled}
          borderWidth={1}
          borderColor="$borderColor"
          bg="$color2"
          px="$2.5"
          maxW="100%"
          iconAfter={<ChevronDown size={compact ? 14 : 16} opacity={0.6} />}
        >
          <XStack gap="$2" items="center" flex={1} minW={0}>
            {current || value ? (
              <ProviderLogo provider={current?.provider ?? 'Other'} model={current ? modelId(current) : value} size={logoSize} mono />
            ) : (
              <Boxes size={compact ? 16 : 18} color="$color10" />
            )}
            <Text
              fontSize={compact ? '$3' : '$4'}
              fontWeight="700"
              color={current || value ? '$color12' : '$color10'}
              numberOfLines={1}
            >
              {currentName || placeholder}
            </Text>
            {!compact ? <ContextBadge context={current ? modelContext(current) : null} /> : null}
          </XStack>
        </Button>
      </Popover.Trigger>
      <Popover.Content {...paper} p="$0" width={420} maxW="92vw">
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
              }}
              placeholder={`Search ${total || ''} models…`.replace('  ', ' ')}
              autoCapitalize="none"
              borderWidth={0}
              bg="transparent"
            />
          </XStack>

          {flat.length === 0 ? (
            <YStack p="$3" gap="$2" minH={96}>
              <Text fontSize="$2" color="$color10">
                {total === 0
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
                  <ProviderLogo provider="Other" model={q.trim()} size={22} mono />
                  <Text fontSize="$3" color="$color12" flex={1} numberOfLines={1}>
                    Use “{q.trim()}”
                  </Text>
                  <Check size={14} />
                </XStack>
              ) : null}
            </YStack>
          ) : (
            <ScrollView maxH={420} showsVerticalScrollIndicator={false}>
              <YStack p="$1.5" gap="$1">
                {visible.map((g) => (
                  <YStack key={g.id} gap="$0.5">
                    {/* Family header */}
                    <XStack items="center" gap="$2" px="$2" py="$1.5">
                      <ProviderLogo provider={g.logo} size={18} mono />
                      <Text fontSize="$2" fontWeight="700" color="$color11" flex={1} numberOfLines={1}>
                        {g.label}
                      </Text>
                      <Text fontSize="$1" color="$color9">
                        {g.models.length}
                      </Text>
                    </XStack>
                    {/* Family models */}
                    {g.models.map((o) => {
                      rowIdx += 1
                      const i = rowIdx
                      const id = modelId(o)
                      const isHi = highlighted?.model === o
                      const isSel = id.toLowerCase() === value.trim().toLowerCase()
                      return (
                        <XStack
                          key={id}
                          id={`${uid}-r-${i}`}
                          items="center"
                          gap="$2.5"
                          px="$2.5"
                          py="$2"
                          rounded="$3"
                          cursor="pointer"
                          hoverStyle={{ bg: '$color4' }}
                          bg={isHi ? '$color4' : isSel ? '$color3' : 'transparent'}
                          onPress={() => pick(id)}
                        >
                          <ProviderLogo provider={o.provider ?? g.logo} model={id} size={22} mono />
                          <YStack flex={1} gap={1} minW={0}>
                            <XStack items="center" gap="$2">
                              <Text fontSize="$3" color="$color12" numberOfLines={1}>
                                {modelDisplayName(o) || id}
                              </Text>
                              {o.premium ? <PremiumChip /> : null}
                              {o.available ? (
                                <Text fontSize="$1" color="$green11">
                                  ● live
                                </Text>
                              ) : null}
                            </XStack>
                            <XStack items="center" gap="$2" flexWrap="wrap">
                              <ContextBadge context={modelContext(o)} />
                              {o.pricing?.input != null ? (
                                <Text fontSize="$1" color="$color10">
                                  {fmtPrice(o.pricing.input)}/M in
                                </Text>
                              ) : null}
                            </XStack>
                          </YStack>
                          <XStack width={16} items="center" justify="center">
                            {isSel ? <Check size={14} /> : null}
                          </XStack>
                        </XStack>
                      )
                    })}
                  </YStack>
                ))}
              </YStack>
            </ScrollView>
          )}
        </YStack>
      </Popover.Content>
    </Popover>
  )
}

/** The flat index (across the family-ordered groups) of the currently-set id, or -1. */
function flatIndexOfValue(groups: ReturnType<typeof groupModelsByFamily>, value: string): number {
  const v = value.trim().toLowerCase()
  if (!v) return -1
  let idx = 0
  for (const g of groups) {
    for (const m of g.models) {
      if (modelId(m).toLowerCase() === v) return idx
      idx++
    }
  }
  return -1
}
