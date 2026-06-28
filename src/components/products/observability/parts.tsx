'use client'

/**
 * Shared detail primitives for the observability surfaces — one place for the
 * label/value row, the tag/badge pills, and the JSON panel so traces, sessions,
 * and scores render identically. Built only on GUI shorthand props.
 */
import type { ReactNode } from 'react'
import { Card, Text, XStack, YStack } from '@hanzo/gui'

import { jsonBlock } from './format'

/** A single label/value row in a detail overview. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <XStack justify="space-between" items="center" gap="$4" py="$2" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontSize="$3" color="$color11" fontWeight="600">
        {label}
      </Text>
      <Text fontSize="$3" color="$color12" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

/** A small neutral pill — observation type, score source, etc. */
export function Badge({ label }: { label: string }) {
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
      {label}
    </Text>
  )
}

/** A right-aligned, wrapping list of tag pills; em dash when empty. */
export function Tags({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) {
    return (
      <Text fontSize="$3" color="$color12">
        —
      </Text>
    )
  }
  return (
    <XStack gap="$1.5" flexWrap="wrap" justify="flex-end">
      {tags.map((t) => (
        <Badge key={t} label={t} />
      ))}
    </XStack>
  )
}

/**
 * A JSON detail panel. Renders the pretty value in a monospace-ish block;
 * react-native-web Text defaults to `white-space: pre-wrap`, so newlines and
 * indentation are preserved on the web target. Renders nothing for empty values.
 */
export function JsonCard({ title, value }: { title: string; value: unknown }) {
  const text = jsonBlock(value)
  if (!text) return null
  return (
    <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
      <Text fontSize="$5" fontWeight="700">
        {title}
      </Text>
      <YStack maxH={360} overflow="scroll" bg="$color2" rounded="$3" p="$3">
        <Text fontSize="$2" color="$color11">
          {text}
        </Text>
      </YStack>
    </Card>
  )
}
