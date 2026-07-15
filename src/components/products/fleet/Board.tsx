'use client'

/**
 * The Fleet board — every unit the org owns or linked, with live health.
 *
 * Scanned, not read: the summary answers "how much have I got and is it OK", the
 * attention banner names anything that needs a look, and the grid orders the flagged
 * units to the top. Every number is real or an em-dash.
 */
import { useMemo, useState } from 'react'
import { Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, Boxes, Cpu, Gauge, MemoryStick, Search, Server, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { MetricCard, SERIES } from '~/components/ui/Metric'
import { EmptyState } from '~/components/ui/EmptyState'
import { FieldSelect } from '~/components/ui/Field'
import { fmtBytes, fmtInt } from '~/lib/api/agents'
import { DASH } from '~/lib/api/visor'
import { memRatio, memTotal, summarize, type FleetUnit } from '~/lib/api/fleet'
import {
  capacityLine,
  filterUnits,
  fmtLoad,
  fmtMemPair,
  fmtRatio,
  isStale,
  loadRatio,
  orderUnits,
  sessionsSummary,
  sourceOptions,
  statusOptions,
  unitSubtitle,
  unitTitle,
  verdictNote,
  verdictOf,
  type FleetFilter,
} from './logic'
import { Dot, Heartbeat, kindIcon, MeterRow, SourceBadge, UnitKindLine, VerdictPill, verdictHex } from './parts'

/**
 * The summary strip.
 *
 * Each capacity tile says how many units it could actually count ("across 4 of 7"),
 * because a fleet where three hosts are silent has an UNKNOWN total, not a smaller
 * one — and a tile that hides that is quietly lying about the size of the fleet.
 */
/** One tile slot. `maxW` stops a tile that wraps onto its own row from stretching full-bleed. */
function Tile({ children }: { children: React.ReactNode }) {
  return (
    <YStack flex={1} minW={168} maxW={360}>
      {children}
    </YStack>
  )
}

function SummaryStrip({ units, nowS }: { units: FleetUnit[]; nowS: number }) {
  const s = useMemo(() => summarize(units, nowS), [units, nowS])
  const across = (from: number) => (from === s.total ? `across all ${s.total}` : `across ${from} of ${s.total}`)

  return (
    <XStack gap="$3" flexWrap="wrap">
      <Tile>
        <MetricCard icon={<Boxes size={16} />} label="Units" value={String(s.total)} caption="linked to your org" />
      </Tile>
      <Tile>
        <MetricCard
          icon={<Activity size={16} />}
          label="Online"
          value={String(s.online)}
          caption={s.stale > 0 ? `${s.stale} online but silent` : `of ${s.total} units`}
        />
      </Tile>
      <Tile>
        <MetricCard
          icon={<Cpu size={16} />}
          label="vCPU"
          value={s.cpus === undefined ? DASH : fmtInt(s.cpus)}
          caption={s.cpusFrom > 0 ? across(s.cpusFrom) : 'no unit reported a core count'}
        />
      </Tile>
      <Tile>
        <MetricCard
          icon={<MemoryStick size={16} />}
          label="Memory"
          value={s.memory === undefined ? DASH : fmtBytes(s.memory)}
          caption={s.memoryFrom > 0 ? across(s.memoryFrom) : 'no unit reported memory'}
        />
      </Tile>
      <Tile>
        <MetricCard
          icon={<Server size={16} />}
          label="GPUs"
          value={s.gpus === undefined ? DASH : String(s.gpus)}
          caption={s.gpusFrom > 0 ? `across ${s.gpusFrom} of ${s.total} units` : 'no GPUs reported'}
        />
      </Tile>
      <Tile>
        <MetricCard
          icon={<Gauge size={16} />}
          label="GPU util"
          value={fmtRatio(s.gpuUtil)}
          caption={s.gpuUtilFrom > 0 ? `mean of ${s.gpuUtilFrom} reporting` : 'no unit reported utilization'}
        />
      </Tile>
    </XStack>
  )
}

/**
 * The attention banner — silence when there is nothing to attend to.
 *
 * This is the "state in form, not just a number" surface: rather than a tile reading
 * "2", it NAMES the units that claim to be online but have stopped reporting, which
 * is the only thing on this board that asks an operator to act.
 */
function AttentionBanner({ units, nowS }: { units: FleetUnit[]; nowS: number }) {
  const flagged = useMemo(() => units.filter((u) => verdictOf(u, nowS) === 'attention'), [units, nowS])
  if (flagged.length === 0) return null
  const names = flagged.slice(0, 4).map(unitTitle).join(', ')
  const more = flagged.length > 4 ? ` and ${flagged.length - 4} more` : ''
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$1" style={{ borderLeft: `3px solid ${SERIES[2]}` }}>
      <XStack items="center" gap="$2">
        <TriangleAlert size={15} color={SERIES[2]} />
        <Text fontSize="$3" fontWeight="600" color="$color12">
          {flagged.length === 1 ? '1 unit is' : `${flagged.length} units are`} online but no longer reporting
        </Text>
      </XStack>
      <Text fontSize="$2" color="$color11">
        {names}
        {more} last sent a heartbeat over {Math.floor(120 / 60)} minutes ago. The unit may be asleep, offline, or its agent
        may have stopped — its live numbers below are the last ones it sent.
      </Text>
    </Card>
  )
}

/**
 * A labelled filter — the `FieldSelect` is a form control (width:100%), so it needs a
 * width-bounded slot to sit in a filter row. Mirrors MachinesModule's FilterSelect.
 */
function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <YStack gap="$1" width={148}>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <FieldSelect value={value} options={options} onChange={onChange} />
    </YStack>
  )
}

/** One unit: identity, state, capacity, live health. */
function UnitCard({ unit, nowS, onOpen }: { unit: FleetUnit; nowS: number; onOpen: () => void }) {
  const Icon = kindIcon(unit.kind)
  const v = verdictOf(unit, nowS)
  const stale = isStale(unit, nowS)
  const note = verdictNote(unit, nowS)
  const sub = unitSubtitle(unit)
  const load = loadRatio(unit)
  const mem = memRatio(unit.metrics)
  const total = memTotal(unit.metrics)

  return (
    <Card
      borderWidth={1}
      borderColor="$borderColor"
      p="$3.5"
      gap="$2.5"
      flex={1}
      minW={286}
      maxW={480}
      hoverStyle={{ borderColor: '$color8' }}
      pressStyle={{ opacity: 0.85 }}
      onPress={onOpen}
      cursor="pointer"
      aria-label={`${unitTitle(unit)} — ${v}`}
    >
      <XStack items="flex-start" justify="space-between" gap="$2">
        <XStack items="center" gap="$2" flex={1} minW={0}>
          <YStack p="$1.5" rounded="$2" bg="$color3">
            <Icon size={14} />
          </YStack>
          <YStack flex={1} minW={0}>
            <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
              {unitTitle(unit)}
            </Text>
            {sub ? (
              <Text fontSize="$1" color="$color10" numberOfLines={1}>
                {sub}
              </Text>
            ) : (
              <UnitKindLine unit={unit} />
            )}
          </YStack>
        </XStack>
        <SourceBadge source={unit.source} />
      </XStack>

      <XStack items="center" justify="space-between" gap="$2">
        <VerdictPill unit={unit} nowS={nowS} />
        <Heartbeat at={unit.metrics.at} nowS={nowS} stale={stale} />
      </XStack>

      {note ? (
        <Text fontSize="$1" color={SERIES[2]}>
          {note}
        </Text>
      ) : null}

      <Text fontSize="$1" color="$color10" numberOfLines={2}>
        {capacityLine(unit.spec)}
      </Text>

      <YStack gap="$1.5">
        <MeterRow label="Load" value={fmtLoad(unit.metrics.load1)} ratio={load} dim={stale} />
        <MeterRow label="Mem" value={fmtMemPair(unit.metrics.memUsed, total)} ratio={mem} dim={stale} />
        <MeterRow label="GPU" value={fmtRatio(unit.metrics.gpuUtil)} ratio={unit.metrics.gpuUtil} dim={stale} />
      </YStack>

      <XStack items="center" gap="$1.5">
        <Dot color={unit.running > 0 ? verdictHex('healthy') : SERIES[7]} size={6} />
        <Text fontSize="$1" color="$color10">
          {sessionsSummary(unit)}
        </Text>
      </XStack>
    </Card>
  )
}

/** The honest first-run state — the fleet is genuinely empty, and here is how to fill it. */
export function FleetEmpty() {
  return (
    <EmptyState
      icon={Boxes}
      title="No compute linked yet"
      description="Fleet shows every machine your organization owns or links — laptops and boxes an agent session registered, bring-your-own workers, in-cloud boxes, and the machines Hanzo manages for you — each with its live load."
      bullets={[
        'Run `hanzo code --link` on a machine to register it as a run-target.',
        'Attach a bring-your-own cluster or GPU host to bring your own compute.',
        'Launch a machine or a GPU box and it appears here automatically.',
      ]}
    />
  )
}

export function FleetBoard({
  units,
  nowS,
  onOpen,
}: {
  units: FleetUnit[]
  nowS: number
  onOpen: (u: FleetUnit) => void
}) {
  const [filter, setFilter] = useState<FleetFilter>({})
  const sources = useMemo(() => sourceOptions(units), [units])
  const statuses = useMemo(() => statusOptions(units), [units])
  const rows = useMemo(() => orderUnits(filterUnits(units, filter), nowS), [units, filter, nowS])

  if (units.length === 0) return <FleetEmpty />

  return (
    <YStack gap="$4">
      <SummaryStrip units={units} nowS={nowS} />
      <AttentionBanner units={units} nowS={nowS} />

      <XStack gap="$3" flexWrap="wrap" items="flex-end">
        <YStack gap="$1" flex={1} minW={190} maxW={320}>
          <Text fontSize="$1" color="$color10">
            Search
          </Text>
          <XStack items="center" gap="$2" px="$2.5" borderWidth={1} borderColor="$borderColor" rounded="$3" height={40}>
            <Search size={14} />
            <Input
              unstyled
              flex={1}
              fontSize="$3"
              color="$color12"
              placeholder="Name, host, OS, GPU…"
              value={filter.search ?? ''}
              onChangeText={(search: string) => setFilter((f) => ({ ...f, search }))}
            />
          </XStack>
        </YStack>
        {sources.length > 2 ? (
          <Filter label="Source" value={filter.source ?? 'all'} options={sources} onChange={(source) => setFilter((f) => ({ ...f, source }))} />
        ) : null}
        {statuses.length > 2 ? (
          <Filter label="Status" value={filter.status ?? 'all'} options={statuses} onChange={(status) => setFilter((f) => ({ ...f, status }))} />
        ) : null}
        <Text fontSize="$1" color="$color10" className="hz-tnum" pb="$2.5">
          {rows.length === units.length ? `${units.length} units` : `${rows.length} of ${units.length}`}
        </Text>
      </XStack>

      {rows.length === 0 ? (
        <Card borderWidth={1} borderColor="$borderColor" borderStyle="dashed" p="$5" items="center">
          <Text fontSize="$3" color="$color11">
            No units match these filters.
          </Text>
        </Card>
      ) : (
        <XStack gap="$3" flexWrap="wrap">
          {rows.map((u) => (
            <UnitCard key={`${u.source ?? ''}/${u.unit}`} unit={u} nowS={nowS} onOpen={() => onOpen(u)} />
          ))}
        </XStack>
      )}
    </YStack>
  )
}
