'use client'

/**
 * Add model — the add-a-column control. A button reveals a filterable list of the
 * REAL catalog models; clicking a model appends it as a new compare column (a model
 * may be added more than once to compare it at different settings). This is the
 * "multi-select from the live catalog" — pick as many as you want, then Done.
 */
import { useMemo, useState } from 'react'
import { Button, Card, Input, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { Plus, Check } from '@hanzogui/lucide-icons-2'

import { providerLabels, type CatalogModel } from '~/lib/api'

export function AddModel({
  models,
  onAdd,
  disabled,
}: {
  models: CatalogModel[]
  onAdd: (id: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [added, setAdded] = useState(0)

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return models
    return models.filter(
      (m) => m.id.toLowerCase().includes(t) || (providerLabels[m.owned_by] ?? m.owned_by).toLowerCase().includes(t),
    )
  }, [models, q])

  if (!open) {
    return (
      <Button
        size="$2"
        icon={<Plus size={15} />}
        disabled={disabled}
        onPress={() => {
          setOpen(true)
          setAdded(0)
        }}
      >
        Add model
      </Button>
    )
  }

  return (
    <Card p="$2.5" gap="$2" borderWidth={1} borderColor="$borderColor" width={300}>
      <Input value={q} onChangeText={setQ} placeholder="Filter models…" autoCapitalize="none" />
      <ScrollView maxH={260}>
        <YStack gap="$1">
          {filtered.length === 0 ? (
            <Text fontSize="$2" color="$color10" p="$2">
              No models match.
            </Text>
          ) : (
            filtered.map((m) => (
              <XStack
                key={m.id}
                gap="$2"
                items="center"
                justify="space-between"
                px="$2"
                py="$1.5"
                rounded="$2"
                cursor="pointer"
                hoverStyle={{ bg: '$color3' }}
                onPress={() => {
                  onAdd(m.id)
                  setAdded((n) => n + 1)
                }}
              >
                <YStack flex={1}>
                  <Text fontSize="$2" color="$color12" numberOfLines={1}>
                    {m.id}
                  </Text>
                  <Text fontSize="$1" color="$color10">
                    {providerLabels[m.owned_by] ?? m.owned_by}
                    {m.premium ? ' · Premium' : ''}
                  </Text>
                </YStack>
                <Plus size={14} />
              </XStack>
            ))
          )}
        </YStack>
      </ScrollView>
      <XStack justify="space-between" items="center">
        <Text fontSize="$1" color="$color10">
          {added > 0 ? `${added} added` : 'Click a model to add a column'}
        </Text>
        <Button size="$2" icon={<Check size={14} />} onPress={() => setOpen(false)}>
          Done
        </Button>
      </XStack>
    </Card>
  )
}
