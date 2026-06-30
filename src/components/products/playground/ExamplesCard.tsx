'use client'

/**
 * ExamplesCard — curated prompt starters (clearly STARTERS, not fabricated
 * history) and the user's own saved prompts. Each row shows the title and a model
 * chip ("· zen-omni"); clicking loads it into the composer (and selects the model
 * when it's in the live catalog). Saved prompts can be removed.
 */
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Sparkles, Bookmark, Trash2 } from '@hanzogui/lucide-icons-2'

import { EXAMPLES, type Example } from './examples'
import type { SavedPrompt } from './prompts'

function ModelChip({ model }: { model: string }) {
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$10" bg="$color3" color="$color11" numberOfLines={1}>
      {model}
    </Text>
  )
}

function RowItem({
  title,
  model,
  onPress,
  onRemove,
}: {
  title: string
  model: string
  onPress: () => void
  onRemove?: () => void
}) {
  return (
    <XStack
      items="center"
      gap="$2"
      px="$2.5"
      py="$2"
      rounded="$3"
      cursor="pointer"
      hoverStyle={{ bg: '$color3' }}
      onPress={onPress}
    >
      <Text fontSize="$2" color="$color12" flex={1} numberOfLines={1}>
        {title}
      </Text>
      <ModelChip model={model} />
      {onRemove ? (
        <Button
          size="$1"
          chromeless
          icon={<Trash2 size={13} />}
          onPress={(e) => {
            ;(e as unknown as { stopPropagation?: () => void }).stopPropagation?.()
            onRemove()
          }}
        />
      ) : null}
    </XStack>
  )
}

export function ExamplesCard({
  onApply,
  saved,
  onApplySaved,
  onRemoveSaved,
}: {
  onApply: (e: Example) => void
  saved: SavedPrompt[]
  onApplySaved: (s: SavedPrompt) => void
  onRemoveSaved: (id: string) => void
}) {
  return (
    <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color1">
      <XStack items="center" gap="$2">
        <Sparkles size={15} color="$color11" />
        <Text fontSize="$4" fontWeight="800">
          Examples
        </Text>
      </XStack>
      <YStack gap="$0.5">
        {EXAMPLES.map((e) => (
          <RowItem key={e.id} title={e.label} model={e.model} onPress={() => onApply(e)} />
        ))}
      </YStack>

      {saved.length > 0 ? (
        <YStack gap="$0.5" borderTopWidth={1} borderColor="$borderColor" pt="$2" mt="$1">
          <XStack items="center" gap="$2" px="$2.5" py="$1">
            <Bookmark size={13} color="$color10" />
            <Text fontSize="$1" color="$color10" letterSpacing={0.5}>
              SAVED
            </Text>
          </XStack>
          {saved.map((s) => (
            <RowItem
              key={s.id}
              title={s.name}
              model={s.model || '—'}
              onPress={() => onApplySaved(s)}
              onRemove={() => onRemoveSaved(s.id)}
            />
          ))}
        </YStack>
      ) : null}
    </Card>
  )
}
