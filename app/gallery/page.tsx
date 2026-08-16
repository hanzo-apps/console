'use client'

/**
 * The gallery — every shared component this console owns, once, with real props.
 *
 * The scorecard sweeps every ROUTE, which covers a component only where some
 * page happens to render it, in whatever state that page happens to put it in.
 * So a component used on one screen was audited once, a component used nowhere
 * yet was audited never, and no component was ever seen in both themes on
 * purpose. `@hanzo/ui` solved this for its own surface with `gallery.tsx` — one
 * list, and every test layer renders THAT rather than keeping its own — and this
 * is the same list for the components that live here.
 *
 * It is a real route, not a test fixture, for the same reason: a fixture is a
 * second copy of the truth that rots quietly. A page the team can open is a page
 * someone notices when it breaks.
 *
 * It sits OUTSIDE `(dashboard)` deliberately — no AuthGate, no shell, no product
 * chrome — so what the gate measures here is the COMPONENT and not the frame
 * around it.
 */
import { Text, XStack, YStack } from '@hanzo/gui'
import { Activity, Cpu, Zap } from '@hanzogui/lucide-icons-2'

import { BarRows, Donut } from '~/components/ui/Charts'
import { Loader } from '~/components/ui/Loader'
import { HintButton, LegendDot, MetricCard, MiniBars, Sparkline, UtilBar } from '~/components/ui/Metric'
import { Monogram } from '~/components/ui/Monogram'
import { SystemStatusBadge } from '~/components/ui/SystemStatusBadge'

/** Real-shaped sample data. Flat or empty series prove nothing about a chart. */
const SERIES = [4, 9, 6, 14, 11, 18, 15, 22, 19, 27, 24, 31]
const SLICES = [
  { label: 'Zen', value: 62, color: '#7C5CFF' },
  { label: 'Claude', value: 24, color: '#D97757' },
  { label: 'Other', value: 14, color: '#4D6BFE' },
]

function Case({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <YStack gap="$2" p="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" minW={260} flex={1}>
      <Text fontSize="$1" color="$color10">
        {name}
      </Text>
      <XStack items="center" gap="$3" flexWrap="wrap">
        {children}
      </XStack>
    </YStack>
  )
}

export default function Gallery() {
  return (
    <YStack p="$4" gap="$4" maxW={1100} self="center" width="100%">
      <YStack gap="$1">
        <Text fontSize="$7" fontWeight="800" color="$color12">
          Component gallery
        </Text>
        <Text fontSize="$2" color="$color10">
          Every shared component this console owns, with real props. The design gate reads this page
          in both themes.
        </Text>
      </YStack>

      <XStack gap="$3" flexWrap="wrap">
        <Case name="MetricCard">
          <MetricCard
            icon={<Zap size={14} />}
            label="Requests"
            value="31.4K"
            caption="last 24h"
            spark={SERIES}
            delta={{ pct: 12 }}
          />
        </Case>

        <Case name="MetricCard · no trend">
          {/* The honest state: a metric with nothing to plot shows an em-dash,
              never a flat line pretending to be data. */}
          <MetricCard icon={<Cpu size={14} />} label="P99" value="—" caption="not reporting" />
        </Case>

        <Case name="Sparkline">
          <Sparkline points={SERIES} />
        </Case>

        <Case name="MiniBars">
          <MiniBars bars={SERIES.slice(0, 6).map((v, i) => ({ label: `d${i + 1}`, value: v }))} />
        </Case>

        <Case name="UtilBar">
          <UtilBar value={18} />
          <UtilBar value={64} />
          <UtilBar value={93} />
        </Case>

        <Case name="LegendDot">
          {SLICES.map((s) => (
            <LegendDot key={s.label} color={s.color} label={s.label} value={`${s.value}%`} />
          ))}
        </Case>

        <Case name="Donut">
          <Donut slices={SLICES} />
        </Case>

        <Case name="BarRows">
          <BarRows bars={SLICES} />
        </Case>

        <Case name="Monogram">
          <Monogram>HZ</Monogram>
          <Monogram>LX</Monogram>
          <Monogram>ZO</Monogram>
        </Case>

        <Case name="SystemStatusBadge">
          <SystemStatusBadge />
        </Case>

        <Case name="HintButton">
          <HintButton icon={<Activity size={14} />}>Enabled</HintButton>
          <HintButton disabled hint="Connect a cluster first">
            Disabled
          </HintButton>
        </Case>

        <Case name="Loader">
          <Loader label="Loading…" size={28} />
        </Case>
      </XStack>
    </YStack>
  )
}
