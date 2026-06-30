'use client'

/**
 * StatTile — a self-contained, data-prop-driven metric tile.
 *
 * Takes only plain props (label, value, sub, icon, loading) so it has no
 * coupling to the AI Metrics data layer and lifts cleanly into `@hanzo/ui` for
 * the mobile/desktop app. Built on @hanzo/gui shorthand style props (v5 config).
 * A `loading` tile shows a spinner in place of the value — never a fake number.
 */
import type { ReactNode } from 'react'
import { Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'

export type StatTileProps = {
  /** The metric name, e.g. "Total tokens". */
  label: string
  /** The formatted value, e.g. "$12.34" or "1,204". Ignored while `loading`. */
  value: string
  /** Optional secondary line, e.g. "↑ 8.0k in · 4.2k out". */
  sub?: string
  /** Optional leading icon (a @hanzogui/lucide-icons-2 element). */
  icon?: ReactNode
  /** Show a spinner instead of the value (honest pending state). */
  loading?: boolean
}

export function StatTile({ label, value, sub, icon, loading }: StatTileProps) {
  return (
    <Card
      flex={1}
      minW={180}
      p="$4"
      gap="$2"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color1"
    >
      <XStack items="center" gap="$2">
        {icon ? <YStack opacity={0.7}>{icon}</YStack> : null}
        <Text fontSize="$2" color="$color10">
          {label}
        </Text>
      </XStack>
      {loading ? (
        <XStack height={34} items="center">
          <Spinner color="$color11" />
        </XStack>
      ) : (
        <Text fontSize="$8" fontWeight="800" color="$color12">
          {value}
        </Text>
      )}
      {sub ? (
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Card>
  )
}
