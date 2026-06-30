'use client'

/**
 * UsageChart — a dependency-free, data-prop-driven bar chart for the per-day
 * usage series. No chart library: bars are height-scaled @hanzo/gui Stacks, so it
 * renders identically on web and native and lifts into `@hanzo/ui` unchanged.
 *
 * It takes a dense `DayBucket[]` (zero-days included) and the metric to plot
 * (requests | tokens | cost), and draws one bar per day with a hover tooltip and
 * a sparse axis. An all-zero window draws a flat honest baseline (no fabricated
 * peaks). The component is presentation-only — all aggregation happens upstream
 * in `lib/api/aimetrics`.
 */
import { useMemo, useState } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'

import type { DayBucket } from '~/lib/api/aimetrics'
import { count, dayLabel, tokens, usd } from './format'

export type ChartMetric = 'requests' | 'tokens' | 'cost'

/** The series value + a formatted label for a given metric. */
function metricValue(b: DayBucket, metric: ChartMetric): { value: number; label: string } {
  if (metric === 'requests') return { value: b.requests, label: count(b.requests) }
  if (metric === 'tokens') return { value: b.tokens, label: tokens(b.tokens) }
  return { value: b.cents, label: usd(b.cents) }
}

const HEIGHT = 160
const MIN_BAR = 2

export function UsageChart({
  series,
  metric,
  height = HEIGHT,
}: {
  series: DayBucket[]
  metric: ChartMetric
  height?: number
}) {
  // Tap a bar to pin its day + value (works on web and native; hover is a
  // pure-CSS color shift via hoverStyle, no JS hover handlers which this gui
  // version doesn't expose on Stacks).
  const [pinned, setPinned] = useState<number | null>(null)

  const max = useMemo(
    () => series.reduce((m, b) => Math.max(m, metricValue(b, metric).value), 0),
    [series, metric],
  )

  if (series.length === 0) {
    return (
      <YStack height={height} items="center" justify="center" borderWidth={1} borderColor="$borderColor" rounded="$4">
        <Text color="$color10" fontSize="$2">
          No usage in this range yet.
        </Text>
      </YStack>
    )
  }

  // Sparse axis: first, middle, last — avoids crowding the 30-day view.
  const axisIdx = new Set([0, Math.floor(series.length / 2), series.length - 1])
  const peak = metricValue(series[Math.max(0, series.findIndex((b) => metricValue(b, metric).value === max))] ?? series[0], metric)

  return (
    <YStack gap="$2" borderWidth={1} borderColor="$borderColor" rounded="$4" p="$4" bg="$color1">
      <XStack justify="space-between" items="baseline">
        <Text fontSize="$2" color="$color10">
          Peak / day
        </Text>
        <Text fontSize="$3" fontWeight="700" color="$color12">
          {max > 0 ? peak.label : '—'}
        </Text>
      </XStack>

      <XStack height={height} items="flex-end" gap={2}>
        {series.map((b, i) => {
          const { value, label } = metricValue(b, metric)
          const h = max > 0 ? Math.max(MIN_BAR, Math.round((value / max) * height)) : MIN_BAR
          const active = pinned === i
          return (
            <YStack
              key={b.day}
              flex={1}
              height={height}
              justify="flex-end"
              items="center"
              cursor="pointer"
              onPress={() => setPinned((cur) => (cur === i ? null : i))}
            >
              {active ? (
                <YStack
                  position="absolute"
                  t={0}
                  bg="$color12"
                  px="$2"
                  py="$1"
                  rounded="$2"
                  z={10}
                  pointerEvents="none"
                >
                  <Text fontSize="$1" color="$color1" numberOfLines={1}>
                    {dayLabel(b.day)} · {label}
                  </Text>
                </YStack>
              ) : null}
              <YStack
                width="100%"
                height={h}
                rounded="$1"
                bg={active ? '$color11' : value > 0 ? '$blue9' : '$color4'}
                hoverStyle={{ bg: value > 0 ? '$blue10' : '$color5' }}
              />
            </YStack>
          )
        })}
      </XStack>

      <XStack justify="space-between">
        {series.map((b, i) =>
          axisIdx.has(i) ? (
            <Text key={b.day} fontSize="$1" color="$color10">
              {dayLabel(b.day)}
            </Text>
          ) : null,
        )}
      </XStack>
    </YStack>
  )
}
