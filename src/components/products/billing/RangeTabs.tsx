'use client'

/**
 * A compact range toggle (24h / 7d / 30d) — the ONE control the billing Overview
 * and Reports use to pick the spend window, matching the `RangeKey` the shared
 * aimetrics roll-ups expect. Small segmented buttons (GCP/Linear-style), theme-native.
 */
import { Button, XStack } from '@hanzo/gui'

import type { RangeKey } from '~/lib/api/aimetrics'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
]

export function RangeTabs({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
      {RANGES.map((r) => (
        <Button
          key={r.key}
          size="$2"
          chromeless
          rounded="$0"
          bg={value === r.key ? '$color5' : 'transparent'}
          onPress={() => onChange(r.key)}
          aria-label={`Range ${r.label}`}
        >
          {r.label}
        </Button>
      ))}
    </XStack>
  )
}
