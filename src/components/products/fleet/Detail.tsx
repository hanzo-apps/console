'use client'

/**
 * One unit in full: what it is, what it is doing now, and how it has been trending.
 *
 * The trend reads `GET /v1/fleet/samples?unit&source&range`. A chart is drawn only
 * where there are at least two REAL points — a single sample is not a trend, and an
 * absent column is a gap, never a plotted zero.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronLeft, RefreshCw } from '@hanzogui/lucide-icons-2'

import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { LineChart } from '~/components/ui/Charts'
import { Panel, SERIES } from '~/components/ui/Metric'
import { fmtBytes, fmtInt } from '~/lib/api/agents'
import { DASH } from '~/lib/api/visor'
import { FleetApi, FLEET_RANGES, memRatio, memTotal, type FleetRange, type FleetSample, type FleetUnit } from '~/lib/api/fleet'
import {
  capacityLine,
  fmtLoad,
  fmtMemPair,
  fmtRatio,
  gpuLabel,
  hasTrend,
  isStale,
  kindLabel,
  loadRatio,
  RANGE_LABEL,
  seriesOf,
  sessionsSummary,
  sourceHint,
  sourceLabel,
  unitSubtitle,
  unitTitle,
  verdictNote,
  type SampleKey,
} from './logic'
import { Fact, Heartbeat, kindIcon, MeterRow, SourceBadge, VerdictPill } from './parts'

type Async =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: FleetSample[] }

/** The range switcher — the same tab-row idiom the other boards use. */
function RangeTabs({ value, onChange }: { value: FleetRange; onChange: (r: FleetRange) => void }) {
  return (
    <XStack gap="$1" bg="$color2" p="$1" rounded="$3">
      {FLEET_RANGES.map((r) => (
        <Button
          key={r}
          size="$2"
          chromeless
          bg={r === value ? '$color5' : 'transparent'}
          onPress={() => onChange(r)}
          aria-label={`Show the last ${RANGE_LABEL[r]}`}
        >
          <Text fontSize="$2" color={r === value ? '$color12' : '$color11'}>
            {RANGE_LABEL[r]}
          </Text>
        </Button>
      ))}
    </XStack>
  )
}

/**
 * One trend. Renders the chart only with two or more real points; otherwise it says
 * WHY there is nothing to show rather than drawing a flat line through invented data.
 */
function Trend({
  title,
  samples,
  metric,
  range,
  color,
  format,
}: {
  title: string
  samples: FleetSample[]
  metric: SampleKey
  range: FleetRange
  color: string
  format: (v: number) => string
}) {
  const points = useMemo(() => seriesOf(samples, metric, range), [samples, metric, range])
  return (
    <Panel title={title}>
      {hasTrend(points) ? (
        <LineChart data={points} height={160} color={color} formatValue={format} />
      ) : (
        <YStack p="$4" items="center">
          <Text fontSize="$2" color="$color10">
            {points.length === 1
              ? 'Only one sample in this window — not enough for a trend.'
              : 'This unit reported no data for this metric in this window.'}
          </Text>
        </YStack>
      )}
    </Panel>
  )
}

export function UnitDetail({ unit, nowS, onBack }: { unit: FleetUnit; nowS: number; onBack: () => void }) {
  const [range, setRange] = useState<FleetRange>('24h')
  const [state, setState] = useState<Async>({ phase: 'loading' })
  const Icon = kindIcon(unit.kind)
  const stale = isStale(unit, nowS)
  const note = verdictNote(unit, nowS)
  const total = memTotal(unit.metrics)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    FleetApi.samples({ unit: unit.unit, source: unit.source, range })
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [unit.unit, unit.source, range])

  useEffect(() => load(), [load])

  const samples = state.phase === 'ready' ? state.data : []
  const sub = unitSubtitle(unit)

  return (
    <YStack gap="$4">
      <XStack items="flex-start" justify="space-between" gap="$3" flexWrap="wrap">
        <XStack items="center" gap="$3" flex={1} minW={220}>
          <Button size="$2" chromeless icon={<ChevronLeft size={16} />} onPress={onBack} aria-label="Back to the fleet">
            Fleet
          </Button>
          <XStack items="center" gap="$2.5" flex={1} minW={0}>
            <YStack p="$2" rounded="$3" bg="$color3">
              <Icon size={16} />
            </YStack>
            <YStack flex={1} minW={0}>
              <Text fontSize="$5" fontWeight="600" color="$color12" numberOfLines={1}>
                {unitTitle(unit)}
              </Text>
              <Text fontSize="$2" color="$color11" numberOfLines={1}>
                {kindLabel(unit.kind)}
                {sub ? ` · ${sub}` : ''}
              </Text>
            </YStack>
          </XStack>
        </XStack>
        <XStack gap="$2" items="center">
          <SourceBadge source={unit.source} />
          <Button size="$2" icon={<RefreshCw size={14} />} onPress={load} aria-label="Reload the trend">
            Refresh
          </Button>
        </XStack>
      </XStack>

      <XStack gap="$3" flexWrap="wrap" items="stretch">
        {/* Live health — the last heartbeat, dimmed when it is old. */}
        <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2.5" flex={1} minW={280}>
          <XStack items="center" justify="space-between">
            <Text fontSize="$4" fontWeight="600" color="$color12">
              Live
            </Text>
            <XStack items="center" gap="$2">
              <VerdictPill unit={unit} nowS={nowS} />
              <Heartbeat at={unit.metrics.at} nowS={nowS} stale={stale} />
            </XStack>
          </XStack>
          {note ? (
            <Text fontSize="$1" color={SERIES[2]}>
              {note} — the numbers below are the last ones it sent.
            </Text>
          ) : null}
          <YStack gap="$2">
            <MeterRow label="Load" value={fmtLoad(unit.metrics.load1)} ratio={loadRatio(unit)} dim={stale} />
            <MeterRow label="Mem" value={fmtMemPair(unit.metrics.memUsed, total)} ratio={memRatio(unit.metrics)} dim={stale} />
            <MeterRow label="GPU" value={fmtRatio(unit.metrics.gpuUtil)} ratio={unit.metrics.gpuUtil} dim={stale} />
          </YStack>
          <YStack gap="$1" pt="$1">
            <Fact label="Load 1 / 5 / 15" value={`${fmtLoad(unit.metrics.load1)} / ${fmtLoad(unit.metrics.load5)} / ${fmtLoad(unit.metrics.load15)}`} />
            <Fact label="Memory free" value={unit.metrics.memFree === undefined ? DASH : fmtBytes(unit.metrics.memFree)} />
          </YStack>
        </Card>

        {/* Spec — what the machine IS. */}
        <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2.5" flex={1} minW={280}>
          <Text fontSize="$4" fontWeight="600" color="$color12">
            Spec
          </Text>
          <YStack gap="$1">
            <Fact label="Operating system" value={unit.spec.os ?? DASH} />
            <Fact label="Architecture" value={unit.spec.arch ?? DASH} />
            <Fact label="Cores" value={unit.spec.cpus === undefined ? DASH : `${fmtInt(unit.spec.cpus)} vCPU`} />
            <Fact label="Memory" value={unit.spec.memory === undefined ? DASH : fmtBytes(unit.spec.memory)} />
            <Fact label="GPUs" value={gpuLabel(unit.spec.gpus)} />
            {unit.spec.gpus.map((g, i) => (
              <Fact
                key={`${g.model ?? 'gpu'}-${i}`}
                label={`  ${g.model ?? g.vendor ?? 'GPU'} VRAM`}
                value={g.memory === undefined ? DASH : fmtBytes(g.memory)}
              />
            ))}
            <Fact label="Host" value={unit.host ?? DASH} />
            <Fact label="Source" value={sourceLabel(unit.source)} />
            <Fact label="Unit id" value={unit.unit} />
          </YStack>
          <Text fontSize="$1" color="$color10">
            {sourceHint(unit.source) ?? capacityLine(unit.spec)}
          </Text>
        </Card>

        {/* Sessions — the unit's OWN authoritative counts. */}
        <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2.5" flex={1} minW={280}>
          <Text fontSize="$4" fontWeight="600" color="$color12">
            Sessions
          </Text>
          <Text fontSize="$6" fontWeight="500" color="$color12" className="hz-mono">
            {fmtInt(unit.sessions)}
          </Text>
          <Text fontSize="$2" color="$color11">
            {sessionsSummary(unit)}
          </Text>
          <Text fontSize="$1" color="$color10">
            Agent and CLI sessions dispatched to this unit. The per-session list is not shown here: the sessions API has no
            per-unit filter yet, and a partial list beside these counts would contradict them.
          </Text>
        </Card>
      </XStack>

      <XStack items="center" justify="space-between" gap="$3" flexWrap="wrap">
        <Text fontSize="$4" fontWeight="600" color="$color12">
          Utilization
        </Text>
        <RangeTabs value={range} onChange={setRange} />
      </XStack>

      {state.phase === 'loading' ? (
        <XStack p="$6" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      ) : state.phase === 'error' ? (
        <BackendStateCard
          state={state.error}
          onRetry={load}
          hint={<Text fontSize="$1" color="$color10">{`GET /v1/fleet/samples?unit=${unit.unit}&range=${range}`}</Text>}
        />
      ) : (
        <XStack gap="$3" flexWrap="wrap">
          <YStack flex={1} minW={300}>
            <Trend title="GPU utilization" samples={samples} metric="gpuUtil" range={range} color={SERIES[3]} format={(v) => `${Math.round(v)}%`} />
          </YStack>
          <YStack flex={1} minW={300}>
            <Trend title="Load average (1m)" samples={samples} metric="load1" range={range} color={SERIES[0]} format={(v) => v.toFixed(2)} />
          </YStack>
          <YStack flex={1} minW={300}>
            <Trend title="Memory used" samples={samples} metric="memUsed" range={range} color={SERIES[1]} format={(v) => fmtBytes(v)} />
          </YStack>
        </XStack>
      )}
    </YStack>
  )
}
