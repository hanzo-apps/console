'use client'

/**
 * Minimal inline-SVG charts — Sparkline, LineChart (multi-series), Donut.
 *
 * FLAG (chart-consolidation reconcile): this is the console's FIRST chart
 * primitive. The Functions Overview and the Embeddings module were both being
 * built in parallel and each needed `src/components/ui/Charts.tsx`; that file did
 * not exist on `main` when this branch started, so this is a self-contained,
 * dependency-free implementation (raw `<svg>`, the same DOM-in-client-component
 * pattern as `ui/Loader.tsx`). When the parallel Embeddings `Charts.tsx` lands,
 * RECONCILE the two into ONE shared primitive (one way to draw a chart) rather
 * than letting both live — this comment is the marker for that pass.
 *
 * These draw ONLY the data they are given. Empty input renders an honest "No data"
 * placeholder — never an invented trend line. Charts legitimately use colour
 * encoding even in the monochrome console (the data dimension needs it).
 */
import type { ReactNode } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'

/** A point on a series — x label `t`, numeric value `v`. */
export type ChartPoint = { t: string; v: number }
/** A named line in a multi-series chart. */
export type ChartSeries = { key: string; points: ChartPoint[] }

/** Muted categorical palette legible on the dark console (chart encoding only). */
export const CHART_COLORS = ['#6ea8fe', '#7ee787', '#f0883e', '#d2a8ff', '#79c0ff', '#ff9492', '#e3b341', '#56d4dd']

/** Semantic tones for invocation status (success / timeout / error). */
export const STATUS_COLORS = { success: '#3fb950', timeout: '#d29922', error: '#f85149' } as const

const colorAt = (i: number): string => CHART_COLORS[i % CHART_COLORS.length]

/** A centered, muted "no data" placeholder used when a chart has nothing to draw. */
function NoData({ height, label }: { height: number; label: string }) {
  return (
    <YStack height={height} items="center" justify="center" borderWidth={1} borderColor="$borderColor" borderStyle="dashed" rounded="$4">
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
    </YStack>
  )
}

/**
 * A tiny trend line for a metric card — no axes, no labels. Renders nothing for
 * fewer than two points (an honest flat absence, not a fabricated line).
 */
export function Sparkline({ values, width = 120, height = 32, color = '#79c0ff' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (!values || values.length < 2) return <YStack width={width} height={height} />
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const p = 2
  const pts = values
    .map((v, i) => {
      const x = p + (i / (values.length - 1)) * (width - 2 * p)
      const y = p + (1 - (v - min) / span) * (height - 2 * p)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/**
 * A multi-series line chart (invocations over time, one line per function).
 * Y scales from 0 to the global max; X is point index. A legend maps each line to
 * its colour. Honest "No data" when there are no points.
 */
export function LineChart({ series, height = 220, emptyLabel = 'No data in this window yet.' }: { series: ChartSeries[]; height?: number; emptyLabel?: string }) {
  const drawable = series.filter((s) => s.points.length >= 2)
  const maxLen = Math.max(0, ...drawable.map((s) => s.points.length))
  const max = Math.max(0, ...drawable.flatMap((s) => s.points.map((p) => p.v)))
  if (drawable.length === 0 || max <= 0) return <NoData height={height} label={emptyLabel} />

  const VBW = 600
  const VBH = height
  const p = 10
  const x = (i: number, n: number) => p + (n <= 1 ? 0 : (i / (n - 1)) * (VBW - 2 * p))
  const y = (v: number) => p + (1 - v / max) * (VBH - 2 * p)

  // Faint gridlines at 0/50/100% of max for read-off.
  const grid = [0, 0.5, 1].map((f) => p + (1 - f) * (VBH - 2 * p))

  return (
    <YStack gap="$2">
      <svg width="100%" height={height} viewBox={`0 0 ${VBW} ${VBH}`} preserveAspectRatio="none" style={{ display: 'block' }} role="img" aria-label="Invocations over time">
        {grid.map((gy, i) => (
          <line key={i} x1={p} x2={VBW - p} y1={gy} y2={gy} stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} />
        ))}
        {drawable.map((s, si) => (
          <polyline
            key={s.key}
            points={s.points.map((pt, i) => `${x(i, s.points.length).toFixed(2)},${y(pt.v).toFixed(2)}`).join(' ')}
            fill="none"
            stroke={colorAt(si)}
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <XStack gap="$3" flexWrap="wrap">
        {drawable.slice(0, 8).map((s, si) => (
          <XStack key={s.key} gap="$1.5" items="center">
            <YStack width={10} height={10} rounded="$1" bg={colorAt(si) as never} />
            <Text fontSize="$1" color="$color11" numberOfLines={1}>
              {s.key}
            </Text>
          </XStack>
        ))}
        {maxLen ? null : null}
      </XStack>
    </YStack>
  )
}

/** One slice of the donut. */
export type DonutSegment = { label: string; value: number; color: string }

/**
 * A donut chart with a centered total. Honest "No data" when every segment is
 * zero. Legend rows show each label, its value, and percent.
 */
export function Donut({ segments, size = 168, centerLabel, emptyLabel = 'No invocations yet.' }: { segments: DonutSegment[]; size?: number; centerLabel?: string; emptyLabel?: string }) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0)
  if (total <= 0) return <NoData height={size} label={emptyLabel} />

  const th = Math.round(size * 0.16)
  const r = (size - th) / 2
  const cx = size / 2
  const cy = size / 2
  const C = 2 * Math.PI * r
  let offset = 0
  const arcs: ReactNode[] = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = s.value / total
      const seg = frac * C
      const node = (
        <circle
          key={s.label}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth={th}
          strokeDasharray={`${seg.toFixed(3)} ${(C - seg).toFixed(3)}`}
          strokeDashoffset={`${(-offset).toFixed(3)}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )
      offset += seg
      return node
    })

  return (
    <XStack gap="$4" items="center" flexWrap="wrap">
      <YStack width={size} height={size} position="relative" items="center" justify="center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Invocation status">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ffffff" strokeOpacity={0.08} strokeWidth={th} />
          {arcs}
        </svg>
        <YStack position="absolute" items="center" justify="center">
          <Text fontSize="$6" fontWeight="900" color="$color12">
            {total >= 1000 ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(total) : total}
          </Text>
          {centerLabel ? (
            <Text fontSize="$1" color="$color10">
              {centerLabel}
            </Text>
          ) : null}
        </YStack>
      </YStack>
      <YStack gap="$1.5" flex={1} minW={140}>
        {segments.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0
          return (
            <XStack key={s.label} gap="$2" items="center" justify="space-between">
              <XStack gap="$1.5" items="center" flex={1}>
                <YStack width={10} height={10} rounded="$1" bg={s.color as never} />
                <Text fontSize="$2" color="$color11" numberOfLines={1}>
                  {s.label}
                </Text>
              </XStack>
              <Text fontSize="$2" color="$color12">
                {s.value.toLocaleString()} · {pct.toFixed(pct >= 99.95 ? 0 : 1)}%
              </Text>
            </XStack>
          )
        })}
      </YStack>
    </XStack>
  )
}
