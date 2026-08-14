'use client'

/**
 * HistoryCard — the recent runs the playground recorded locally (newest first).
 * Each row shows the prompt, the model chip, real tokens + cost, and a relative
 * time; clicking replays it into the composer. Honest-empty until the first run —
 * "No runs yet" rather than fabricated rows.
 */
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { History as HistoryIcon, Eraser } from '@hanzogui/lucide-icons-2'

import { relativeTime } from './relative'
import { formatTokens, formatUsd } from './cost'
import type { HistoryEntry } from './history'

export function HistoryCard({
  history,
  onReplay,
  onClear,
}: {
  history: HistoryEntry[]
  onReplay: (e: HistoryEntry) => void
  onClear: () => void
}) {
  return (
    <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color1">
      <XStack items="center" justify="space-between">
        <XStack items="center" gap="$2">
          <HistoryIcon size={15} color="$color11" />
          <Text fontSize="$4" fontWeight="800">
            History
          </Text>
        </XStack>
        {history.length > 0 ? (
          <Button size="$1" chromeless icon={<Eraser size={13} />} onPress={onClear}>
            <Text fontSize="$1" color="$color10">
              Clear history
            </Text>
          </Button>
        ) : null}
      </XStack>

      {history.length === 0 ? (
        <YStack py="$4" items="center" gap="$1">
          <Text fontSize="$3" color="$color11" fontWeight="600">
            No runs yet
          </Text>
          <Text fontSize="$2" color="$color10" text="center">
            Run a prompt and it appears here.
          </Text>
        </YStack>
      ) : (
        <YStack gap="$0.5">
          {history.map((h) => {
            const col = h.columns[0]
            return (
              <XStack
                key={h.id}
                items="center"
                gap="$2"
                px="$2.5"
                py="$2"
                rounded="$3"
                cursor="pointer"
                hoverStyle={{ bg: '$color3' }}
                onPress={() => onReplay(h)}
              >
                <YStack flex={1} gap={1}>
                  <Text fontSize="$2" color="$color12" numberOfLines={1}>
                    {h.user || '(no prompt)'}
                  </Text>
                  <XStack gap="$2" items="center" flexWrap="wrap">
                    {col ? (
                      <Text fontSize="$1" px="$2" py="$1" rounded="$10" bg="$color3" color="$color11" numberOfLines={1}>
                        {col.model}
                      </Text>
                    ) : null}
                    {col ? (
                      <Text fontSize="$1" color="$color10">
                        {formatTokens(col.promptTokens)}/{formatTokens(col.completionTokens)} tok · {formatUsd(col.totalUsd)}
                      </Text>
                    ) : null}
                  </XStack>
                </YStack>
                <Text fontSize="$1" color="$color9">
                  {relativeTime(h.at)}
                </Text>
              </XStack>
            )
          })}
        </YStack>
      )}
    </Card>
  )
}
