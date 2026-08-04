'use client'

/**
 * Shared presentational parts for the Functions module — the metric card, the
 * honest engine badge, the period delta, and the honest-disabled action hint.
 * Built only on shared GUI primitives + the catalog icon type, so the Overview,
 * the table, and the rail read identically. No data is produced here.
 */
import { useState, type ReactElement, type ReactNode } from 'react'
import { Button, Popover, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowDownRight, ArrowUpRight } from '@hanzogui/lucide-icons-2'

import type { ProductIcon } from '~/lib/products/registry'
import { toneColor } from '~/components/ui/tone'
import { paper } from '~/components/ui/paper'

/**
 * The honest engine badge. `hanzoai/functions` is a **Fission** fork (the design
 * mock said "OpenFaaS", but the OpenFaaS manifests are dead — no GHCR images — and
 * the live engine per `go.mod` + `universe/infra/k8s/functions` is Fission). We
 * label the real engine, never the wrong one.
 */
export function EngineBadge({ label = 'Serverless' }: { label?: string }) {
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$10" bg="$color3" color="$color11" fontWeight="700">
      {label}
    </Text>
  )
}

/**
 * A period delta pill — only rendered for a REAL, series-derived change
 * (`trendPct`); a `null`/`undefined` pct renders nothing (no fabricated trend).
 */
export function Delta({ pct }: { pct?: number | null }) {
  if (pct === undefined || pct === null || !Number.isFinite(pct)) return null
  const up = pct >= 0
  const Arrow = up ? ArrowUpRight : ArrowDownRight
  const color = toneColor(up ? 'positive' : 'critical')
  return (
    <XStack gap="$0.5" items="center">
      <Arrow size={12} color={color} />
      <Text fontSize="$1" color={color}>
        {Math.abs(pct).toFixed(1)}%
      </Text>
    </XStack>
  )
}

/** One metric card — label, big value, optional sub line, optional sparkline + delta. */
export function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  spark,
  delta,
}: {
  icon?: ProductIcon
  label: string
  value: string
  sub?: string
  spark?: ReactNode
  delta?: ReactNode
}) {
  return (
    <YStack
      flex={1}
      minW={180}
      p="$3.5"
      gap="$2"
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$4"
      bg="$color1"
    >
      <XStack items="center" justify="space-between" gap="$2">
        <XStack gap="$1.5" items="center" flex={1}>
          {Icon ? <Icon size={14} color="$color10" /> : null}
          <Text fontSize="$2" color="$color11" fontWeight="600" numberOfLines={1}>
            {label}
          </Text>
        </XStack>
        {delta}
      </XStack>
      <Text className="tnum" fontSize="$8" fontWeight="900" color="$color12" letterSpacing={-0.5} numberOfLines={1}>
        {value}
      </Text>
      <XStack items="flex-end" justify="space-between" gap="$2" minH={20}>
        <Text fontSize="$1" color="$color10" numberOfLines={1} flex={1}>
          {sub ?? ''}
        </Text>
        {spark}
      </XStack>
    </YStack>
  )
}

/**
 * An honest-disabled action — the control looks inactive (muted) and, on press,
 * reveals WHY it is unavailable instead of doing nothing or pretending to work.
 * Used for Deploy / Edit / Delete when the Functions backend is not reachable, so
 * the console never calls a fabricated endpoint.
 */
export function DisabledAction({
  label,
  icon,
  reason,
  size = '$2',
}: {
  label: string
  icon?: ReactElement
  reason: string
  size?: '$2' | '$3'
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-end">
      <Popover.Trigger asChild>
        <Button size={size} icon={icon} opacity={0.55}>
          {label}
        </Button>
      </Popover.Trigger>
      <Popover.Content {...paper} p="$3" maxW={300}>
        <Text fontSize="$2" color="$color11">
          {reason}
        </Text>
      </Popover.Content>
    </Popover>
  )
}
