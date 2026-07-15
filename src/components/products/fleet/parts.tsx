'use client'

/**
 * Fleet board — the shared visual atoms.
 *
 * Colour is SEMANTIC and separate from the product accent: a unit's tone says how it
 * is doing, never which brand it belongs to. Every hex is drawn from the console's
 * existing `SERIES` palette (`~/components/ui/Metric`) so the board sits inside the
 * design system rather than beside it, and the meters reuse the shared `UtilBar`
 * (which tones itself green → amber → red by value).
 */
import type { ReactElement } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'
import { Box, Cloud, Cpu, HardDrive, Laptop, Network, Server } from '@hanzogui/lucide-icons-2'

import { SERIES, UtilBar } from '~/components/ui/Metric'
import type { ProductIcon } from '~/lib/products/registry'
import type { FleetUnit } from '~/lib/api/fleet'
import { agoLabel } from '~/lib/api/fleet'
import { kindLabel, sourceLabel, verdictOf, type Verdict } from './logic'

/**
 * Verdict → tone. `quiet` (offline) is GREY, not red: a laptop that closed its lid is
 * an expected absence, not a failure, and colouring it like an outage trains an
 * operator to ignore the colour. Amber is reserved for the one state that asks for
 * action — online but no longer reporting.
 */
const VERDICT_HEX: Record<Verdict, string> = {
  attention: SERIES[2], // amber — look at this
  healthy: SERIES[1], // green
  draining: SERIES[0], // blue — a deliberate operator action, informational
  quiet: SERIES[7], // muted — an expected absence
}

const VERDICT_LABEL: Record<Verdict, string> = {
  attention: 'Not reporting',
  healthy: 'Online',
  draining: 'Draining',
  quiet: 'Offline',
}

export const verdictHex = (v: Verdict): string => VERDICT_HEX[v]

const KIND_ICON: Record<string, ProductIcon> = {
  laptop: Laptop,
  cloud: Cloud,
  gpu: Cpu,
  cluster: Network,
  machine: Server,
  worker: HardDrive,
}

/** The kind icon; an unrecognized kind gets the generic box rather than a wrong picture. */
export const kindIcon = (kind?: string): ProductIcon => (kind ? (KIND_ICON[kind] ?? Box) : Box)

/** A coloured dot — inline SVG so the fill is a raw hex (the house pattern). */
export function Dot({ color, size = 8 }: { color: string; size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="5" fill={color} />
    </svg>
  )
}

/**
 * The status pill: the unit's DECLARED status fused with whether it is still
 * reporting. "Online" and "online but silent for 20m" are different operational
 * facts and must never render identically.
 */
export function VerdictPill({ unit, nowS }: { unit: FleetUnit; nowS: number }): ReactElement {
  const v = verdictOf(unit, nowS)
  // An unknown backend status shows ITSELF rather than being coerced into one of ours.
  const known = unit.status === 'online' || unit.status === 'offline' || unit.status === 'draining'
  const label = v === 'quiet' && unit.status && !known ? unit.status : VERDICT_LABEL[v]
  return (
    <XStack items="center" gap="$1.5">
      <Dot color={VERDICT_HEX[v]} />
      <Text fontSize="$2" color="$color12">
        {label}
      </Text>
    </XStack>
  )
}

/** The source badge — which plane this unit came from. */
export function SourceBadge({ source }: { source?: string }): ReactElement {
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11" textTransform="uppercase">
      {sourceLabel(source)}
    </Text>
  )
}

/** "12s ago", dimmed once the heartbeat is stale so the age reads as a warning itself. */
export function Heartbeat({ at, nowS, stale }: { at?: number; nowS: number; stale: boolean }): ReactElement {
  return (
    <Text fontSize="$1" color={stale ? SERIES[2] : '$color10'} className="hz-mono">
      {agoLabel(at, nowS)}
    </Text>
  )
}

/**
 * One live-health row: a label, the real value, and a bar.
 *
 * The bar appears ONLY when a ratio is genuinely known — an unreported metric shows
 * the em-dash and NO bar, because an empty bar reads as "0%", which is a fabrication.
 * A stale value is dimmed: it is real, but it is old.
 */
export function MeterRow({
  label,
  value,
  ratio,
  dim,
}: {
  label: string
  value: string
  ratio?: number
  dim?: boolean
}): ReactElement {
  return (
    <XStack items="center" gap="$2">
      <Text fontSize="$1" color="$color10" width={34}>
        {label}
      </Text>
      <Text fontSize="$2" color={dim ? '$color10' : '$color12'} className="hz-mono" flex={1} minW={0} numberOfLines={1}>
        {value}
      </Text>
      {ratio !== undefined ? <UtilBar value={ratio * 100} width={72} /> : null}
    </XStack>
  )
}

/** A labelled fact — the detail view's spec rows. Value is pre-formatted (so `—` is honest). */
export function Fact({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <XStack justify="space-between" gap="$3" items="baseline">
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" className="hz-mono" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

/** The kind + label line used in both the card and the detail header. */
export function UnitKindLine({ unit }: { unit: FleetUnit }): ReactElement {
  return (
    <Text fontSize="$1" color="$color10">
      {kindLabel(unit.kind)}
    </Text>
  )
}
