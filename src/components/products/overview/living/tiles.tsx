'use client'

/**
 * LivingOverview tiles — the ONE animated, honest tile set every product overview
 * composes. Each tile is thin: it reads its slice out of `OverviewData` via the
 * pure selectors, formats via the pure logic, and animates via the hooks. It never
 * decides what's real — an absent slice renders a skeleton/em-dash, and reduced
 * motion snaps every number/entrance to its end state.
 *
 * Charts are reused verbatim from `~/components/ui/Charts` (the ONE way the console
 * draws a trend/series/share). Style props are the v5 shorthand set. Raw/SVG colors
 * go through inline `style` (Charts already do this internally).
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Clock, TrendingDown, TrendingUp } from '@hanzogui/lucide-icons-2'

import {
  BarChart,
  CHART_OTHER,
  CHART_PALETTE,
  Donut,
  LineChart,
  Sparkline,
  type ChartPoint,
  type Slice,
} from '~/components/ui/Charts'
import { useCountUp, useReducedMotion } from './hooks'
import {
  ago,
  deltaOf,
  distributionTotal,
  formatMetric,
  hasTrend,
  healthColor,
  healthTally,
  selectDistribution,
  selectKpi,
  selectSeries,
  severityColor,
  statusColor,
  windowRows,
  worstHealth,
  OK,
  MUTED,
} from './logic'
import type {
  ActivityTile,
  AlertsTile,
  DistributionTile,
  HealthTile,
  MetricTile,
  MetricUnit,
  OverviewData,
  TimeseriesTile,
} from './config'

const UP = '#23c562'
const DOWN = '#ef4444'

/** Format an axis label for a series interval. */
const fmtAxis = (iso: string, interval: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return interval === 'day'
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** A titled panel shell (matches the console's Panel idiom). */
function Panel({ title, right, children, minW = 320, flex }: { title: string; right?: ReactNode; children: ReactNode; minW?: number; flex?: number }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" flex={flex} minW={minW}>
      <XStack items="center" justify="space-between" gap="$2">
        <Text fontSize="$4" fontWeight="500" color="$color12">
          {title}
        </Text>
        {right}
      </XStack>
      {children}
    </Card>
  )
}

// ── Metric tile (count-up + live sparkline + delta) ──────────────────────────

export function MetricTileView({ tile, data, loading, live, index }: { tile: MetricTile; data: OverviewData | null; loading: boolean; live: boolean; index: number }) {
  const reduced = useReducedMotion()
  const kpi = data ? selectKpi(data, tile.key) : undefined
  const raw = kpi?.value ?? 0
  const animate = live && !reduced && kpi !== undefined
  const shown = useCountUp(raw, animate)
  const color = tile.color ?? CHART_PALETTE[index % CHART_PALETTE.length]
  const delta = deltaOf(kpi)
  const Icon = tile.icon

  return (
    // Responsive KPI columns, so a 4-card row balances instead of wrapping 3+1: one
    // column on phones, two from md (fixes the tablet 3+1), four from xl. flexGrow
    // equalizes the widths within each row; the basis just fixes how many fit.
    <Card
      borderWidth={1}
      borderColor="$borderColor"
      p="$4"
      gap="$2"
      flexGrow={1}
      flexShrink={1}
      flexBasis="100%"
      $md={{ flexBasis: '48%' }}
      $xl={{ flexBasis: '22%' }}
      minW={200}
    >
      <XStack items="center" gap="$2">
        <Icon size={15} opacity={0.7} />
        <Text fontSize="$2" color="$color10" numberOfLines={1}>
          {tile.label}
        </Text>
      </XStack>

      {loading && kpi === undefined ? (
        <SkeletonBar w={110} h={34} />
      ) : (
        <Text fontSize="$9" fontWeight="500" color="$color12" numberOfLines={1} className="hz-tnum">
          {kpi === undefined ? '—' : formatMetric(shown, tile.unit)}
        </Text>
      )}

      <XStack justify="space-between" items="flex-end" gap="$2">
        <YStack gap="$1">
          {tile.caption ? (
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {tile.caption}
            </Text>
          ) : null}
          <DeltaPill delta={delta} unit={tile.unit} kpi={kpi} loading={loading} />
        </YStack>
        {hasTrend(kpi?.series) ? <Sparkline values={kpi!.series!} color={color} /> : null}
      </XStack>
    </Card>
  )
}

function DeltaPill({ delta, loading, kpi }: { delta: { pct: number; up: boolean } | null; unit?: MetricUnit; kpi?: unknown; loading: boolean }) {
  if (loading && kpi === undefined) return <SkeletonBar w={80} h={12} />
  if (!delta) {
    return (
      <Text fontSize="$1" color="$color10">
        — vs prior
      </Text>
    )
  }
  const Icon = delta.up ? TrendingUp : TrendingDown
  const color = delta.up ? UP : DOWN
  return (
    <XStack items="center" gap="$1">
      <Icon size={12} color={color} />
      <Text fontSize="$1" fontWeight="700" style={{ color }}>
        {`${delta.up ? '+' : ''}${delta.pct}%`}
      </Text>
      <Text fontSize="$1" color="$color10">
        vs prior
      </Text>
    </XStack>
  )
}

// ── Timeseries tile ──────────────────────────────────────────────────────────

export function TimeseriesTileView({ tile, data, loading }: { tile: TimeseriesTile; data: OverviewData | null; loading: boolean }) {
  const series = data ? selectSeries(data, tile.key) : undefined
  const points: ChartPoint[] = (series?.points ?? []).map((p) => ({ label: fmtAxis(p.t, series?.interval ?? 'day'), value: p.value }))
  const fmt = (v: number) => formatMetric(v, tile.unit)
  const total = points.reduce((s, p) => s + p.value, 0)

  return (
    <Panel title={tile.title} flex={1} right={points.length ? <Text fontSize="$2" color="$color10" className="hz-tnum">{fmt(total)}</Text> : undefined}>
      {loading && series === undefined ? (
        <SkeletonBar w="100%" h={200} />
      ) : points.length < 2 ? (
        <EmptyPanel note="Not enough data in this range yet." />
      ) : tile.kind === 'bar' ? (
        <BarChart data={points} color={CHART_PALETTE[1]} formatValue={fmt} />
      ) : (
        <LineChart data={points} color={CHART_PALETTE[0]} formatValue={fmt} />
      )}
    </Panel>
  )
}

// ── Distribution tile (donut + legend) ───────────────────────────────────────

export function DistributionTileView({ tile, data, loading }: { tile: DistributionTile; data: OverviewData | null; loading: boolean }) {
  const raw = data ? selectDistribution(data, tile.key) : []
  const total = distributionTotal(raw)
  const slices: Slice[] = raw
    .filter((s) => s.value > 0)
    .map((s, i) => ({ label: s.label, value: s.value, color: i < CHART_PALETTE.length ? CHART_PALETTE[i] : CHART_OTHER }))
  const fmt = (v: number) => formatMetric(v, tile.unit)

  return (
    <Panel title={tile.title} flex={1} minW={340}>
      {loading && raw.length === 0 ? (
        <XStack p="$4" justify="center">
          <SkeletonBar w={160} h={160} rounded />
        </XStack>
      ) : total <= 0 ? (
        <EmptyPanel note="No breakdown recorded in this range." />
      ) : (
        <XStack flexWrap="wrap" gap="$4" items="center">
          <Donut
            slices={slices}
            center={
              <>
                <Text fontSize="$5" fontWeight="500" color="$color12" className="hz-tnum">
                  {fmt(total)}
                </Text>
                {tile.centerLabel ? (
                  <Text fontSize="$1" color="$color10">
                    {tile.centerLabel}
                  </Text>
                ) : null}
              </>
            }
          />
          <YStack flex={1} minW={200} gap="$2">
            {raw.filter((s) => s.value > 0).map((s, i) => (
              <XStack key={s.label} items="center" gap="$2.5">
                <YStack width={10} height={10} rounded="$10" style={{ backgroundColor: i < CHART_PALETTE.length ? CHART_PALETTE[i] : CHART_OTHER }} />
                <YStack flex={1}>
                  <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
                    {s.label}
                  </Text>
                  {s.sub ? (
                    <Text fontSize="$1" color="$color10" numberOfLines={1}>
                      {s.sub}
                    </Text>
                  ) : null}
                </YStack>
                <YStack items="flex-end">
                  <Text fontSize="$3" fontWeight="500" color="$color12" className="hz-tnum">
                    {fmt(s.value)}
                  </Text>
                  <Text fontSize="$1" color="$color10" className="hz-tnum">
                    {Math.round((s.value / total) * 100)}%
                  </Text>
                </YStack>
              </XStack>
            ))}
          </YStack>
        </XStack>
      )}
    </Panel>
  )
}

// ── Live activity stream (virtualized) ───────────────────────────────────────

const ROW_H = 52
const VIEWPORT_H = 360

export function ActivityTileView({ tile, data, loading }: { tile: ActivityTile; data: OverviewData | null; loading: boolean }) {
  const [scrollTop, setScrollTop] = useState(0)
  const nowRef = useRef(Date.now())
  nowRef.current = Date.now()
  const rows = data?.activity ?? []
  // Virtualize only when the stream is long; small feeds render whole (no scroll jank).
  const virtualize = rows.length > Math.ceil(VIEWPORT_H / ROW_H)
  const win = useMemo(() => windowRows(rows, scrollTop, ROW_H, VIEWPORT_H), [rows, scrollTop])

  return (
    <Panel title={tile.title ?? 'Live activity'} right={<LiveDot on={!loading && rows.length > 0} />}>
      {loading && rows.length === 0 ? (
        <YStack gap="$2">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBar key={i} w="100%" h={ROW_H - 12} />
          ))}
        </YStack>
      ) : rows.length === 0 ? (
        <EmptyPanel note={tile.empty ?? 'No activity in this range yet.'} />
      ) : virtualize ? (
        <div
          style={{ height: VIEWPORT_H, overflowY: 'auto' }}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
          <div style={{ height: win.padTop }} />
          {win.slice.map((e) => (
            <ActivityRow key={e.id || `${e.time}-${e.title}`} title={e.title} subtitle={e.subtitle} status={e.status} when={ago(e.time, nowRef.current)} />
          ))}
          <div style={{ height: win.padBottom }} />
        </div>
      ) : (
        <YStack>
          {rows.map((e) => (
            <ActivityRow key={e.id || `${e.time}-${e.title}`} title={e.title} subtitle={e.subtitle} status={e.status} when={ago(e.time, nowRef.current)} />
          ))}
        </YStack>
      )}
    </Panel>
  )
}

function ActivityRow({ title, subtitle, status, when }: { title: string; subtitle?: string; status: string; when: string }) {
  return (
    <XStack items="center" gap="$3" py="$2.5" borderBottomWidth={1} borderColor="$borderColor" style={{ height: ROW_H }}>
      <YStack width={8} height={8} rounded="$10" style={{ backgroundColor: statusColor(status) }} />
      <YStack flex={1}>
        <Text fontSize="$3" color="$color12" numberOfLines={1}>
          {title || 'Event'}
        </Text>
        {subtitle ? (
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </YStack>
      <XStack items="center" gap="$1.5">
        <Clock size={12} opacity={0.6} />
        <Text fontSize="$2" color="$color11">
          {when}
        </Text>
      </XStack>
    </XStack>
  )
}

// ── Alerts tile ──────────────────────────────────────────────────────────────

export function AlertsTileView({ tile, data, loading }: { tile: AlertsTile; data: OverviewData | null; loading: boolean }) {
  const alerts = data?.alerts ?? []
  return (
    <Panel title={tile.title ?? 'Alerts'}>
      {loading && alerts.length === 0 ? (
        <SkeletonBar w="100%" h={44} />
      ) : alerts.length === 0 ? (
        <XStack items="center" gap="$2">
          <YStack width={9} height={9} rounded="$10" style={{ backgroundColor: OK }} />
          <Text fontSize="$3" color="$color11">
            No active alerts.
          </Text>
        </XStack>
      ) : (
        <YStack gap="$2.5">
          {alerts.map((a) => (
            <XStack key={a.id || a.title} items="flex-start" gap="$2.5">
              <YStack width={9} height={9} rounded="$10" mt="$1.5" style={{ backgroundColor: severityColor(a.severity) }} />
              <YStack flex={1}>
                <Text fontSize="$3" fontWeight="600" color="$color12">
                  {a.title}
                </Text>
                {a.detail ? (
                  <Text fontSize="$1" color="$color10">
                    {a.detail}
                  </Text>
                ) : null}
              </YStack>
            </XStack>
          ))}
        </YStack>
      )}
    </Panel>
  )
}

// ── Health board ─────────────────────────────────────────────────────────────

export function HealthTileView({ tile, data, loading }: { tile: HealthTile; data: OverviewData | null; loading: boolean }) {
  const rows = data?.health ?? []
  const worst = worstHealth(rows)
  const { healthy, total } = healthTally(rows)
  const headColor = worst === 'red' ? DOWN : worst === 'yellow' ? '#f0a868' : worst === 'green' ? OK : MUTED

  return (
    <Panel
      title={tile.title ?? 'System health'}
      right={
        total > 0 ? (
          <XStack items="center" gap="$2">
            <YStack width={9} height={9} rounded="$10" style={{ backgroundColor: headColor }} />
            <Text fontSize="$2" color="$color10">
              {healthy}/{total} healthy
            </Text>
          </XStack>
        ) : undefined
      }
    >
      {loading && rows.length === 0 ? (
        <SkeletonBar w="100%" h={40} />
      ) : rows.length === 0 ? (
        <EmptyPanel note={tile.empty ?? 'Health is reported once the control plane is reachable.'} />
      ) : (
        <XStack flexWrap="wrap" gap="$2">
          {rows.map((r) => (
            <XStack key={r.service} items="center" gap="$2" bg="$color2" px="$2.5" py="$1.5" rounded="$10" borderWidth={1} borderColor="$borderColor">
              <YStack width={8} height={8} rounded="$10" style={{ backgroundColor: healthColor(r.health) }} />
              <Text fontSize="$2" color="$color11" numberOfLines={1}>
                {r.service}
              </Text>
            </XStack>
          ))}
        </XStack>
      )}
    </Panel>
  )
}

// ── shared bits ──────────────────────────────────────────────────────────────

/** A pulsing "live" indicator (steady dot under reduced motion). */
function LiveDot({ on }: { on: boolean }) {
  const reduced = useReducedMotion()
  if (!on) return null
  return (
    <XStack items="center" gap="$1.5">
      <YStack width={7} height={7} rounded="$10" style={{ backgroundColor: OK, animation: reduced ? undefined : 'hz-pulse 1.6s ease-in-out infinite' }} />
      <Text fontSize="$1" color="$color10">
        Live
      </Text>
    </XStack>
  )
}

/** A shimmer skeleton block (honest "loading", not fabricated content). */
export function SkeletonBar({ w, h, rounded }: { w: number | string; h: number; rounded?: boolean }) {
  return (
    <div
      className="hz-skeleton"
      style={{ width: w, height: h, borderRadius: rounded ? '50%' : 8 }}
      aria-hidden
    />
  )
}

function EmptyPanel({ note }: { note: string }) {
  return (
    <YStack p="$5" items="center" gap="$1">
      <Text fontSize="$3" color="$color11">
        {note}
      </Text>
    </YStack>
  )
}

/** A loading spinner centered in a panel (used by the driver's first paint). */
export function PanelSpinner() {
  return (
    <XStack p="$6" justify="center">
      <Spinner size="large" color="$color11" />
    </XStack>
  )
}
