'use client'

/**
 * ModelPicker — the composer's model chip + a searchable popover of the REAL
 * catalog (375 models). The chip shows the provider mark, the model name and a
 * "128K context" badge from the model's real context window; each popover row adds
 * the $/Mtok input price and a live "available" dot. Picking a model sets it; a
 * hand-set id that isn't in the catalog still renders (honest — shows the id).
 */
import { useMemo, useState } from 'react'
import { Button, Input, Popover, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronDown, Check, Search, Boxes } from '@hanzogui/lucide-icons-2'

import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { fmtContext, fmtPrice } from '~/lib/api/aicatalog'
import type { ModelOption } from './useModels'

function ContextBadge({ context }: { context: number | null }) {
  if (context == null) return null
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$10" bg="$color3" color="$color11">
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
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const current = options.find((o) => o.id === value)

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return options
    return options.filter(
      (o) => o.id.toLowerCase().includes(t) || o.name.toLowerCase().includes(t) || o.provider.toLowerCase().includes(t),
    )
  }, [options, q])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQ('')
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
          iconAfter={<ChevronDown size={16} opacity={0.6} />}
        >
          <XStack gap="$2" items="center">
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
      <Popover.Content bordered elevate p="$0" minW={380} bg="$color2" borderColor="$borderColor">
        <YStack minW={380} maxW={460}>
          <XStack p="$2" borderBottomWidth={1} borderColor="$borderColor" items="center" gap="$2">
            <Search size={15} color="$color10" />
            <Input
              flex={1}
              size="$3"
              value={q}
              onChangeText={setQ}
              placeholder="Search 375 models…"
              autoCapitalize="none"
              borderWidth={0}
              bg="transparent"
            />
          </XStack>
          <ScrollView maxH={360}>
            <YStack p="$1.5" gap="$0.5">
              {filtered.length === 0 ? (
                <YStack p="$2.5" gap="$2">
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
                filtered.slice(0, 200).map((o) => (
                  <XStack
                    key={o.id}
                    items="center"
                    gap="$2.5"
                    px="$2.5"
                    py="$2"
                    rounded="$3"
                    cursor="pointer"
                    hoverStyle={{ bg: '$color4' }}
                    bg={o.id === value ? '$color4' : 'transparent'}
                    onPress={() => pick(o.id)}
                  >
                    <ProviderLogo provider={o.provider} size={24} />
                    <YStack flex={1} gap={1}>
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
                      <Text fontSize="$1" color="$color10" numberOfLines={1}>
                        {o.provider} · {fmtContext(o.context)} · {fmtPrice(o.inputPrice)}/M in
                      </Text>
                    </YStack>
                    <XStack width={16} items="center" justify="center">
                      {o.id === value ? <Check size={14} /> : null}
                    </XStack>
                  </XStack>
                ))
              )}
              {filtered.length > 200 ? (
                <Text fontSize="$1" color="$color10" px="$2.5" py="$2">
                  Showing the first 200 of {filtered.length}. Keep typing to narrow.
                </Text>
              ) : null}
            </YStack>
          </ScrollView>
        </YStack>
      </Popover.Content>
    </Popover>
  )
}
