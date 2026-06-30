'use client'

/**
 * Tiny, dependency-free SVG chart primitives for the GPUs surface.
 *
 * They render EXACTLY the data passed — no interpolation of missing points, no
 * fabricated baselines, no demo series. A caller with no real data renders an honest
 * empty state instead of one of these (NEVER a fake chart). Colors are presentation,
 * not data: a fixed palette that reads on both the dark default and light themes.
 *
 * Inline SVG is the house pattern here (see ui/Loader, ui/HanzoMark, SignInForm).
 */
import type { ReactElement, ReactNode } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'

/** Distinct, theme-neutral series colors (mid-saturation reads on dark + light). */
export const SERIES = ['#6ea8fe', '#7ee787', '#f0a868', '#c792ea', '#56d4c4', '#e879a6', '#d6c15a', '#8b9bb4'] as const
export const colorForIndex = (i: number): string => SERIES[i % SERIES.length]
const TRACK = 'rgba(128,128,128,0.18)'

/** Tone for a utilization/temperature value (green calm → red hot). */
export function utilColor(pct: number): string {
  if (pct >= 90) return '#e5534b'
  if (pct >= 70) return '#f0a868'
  return '#7ee787'
}

/**
 * A single-series sparkline over real points. Renders nothing meaningful for <2
 * points (the caller shows `—` instead). The y-range is the data's own min/max.
 */
export function Sparkline({
  points,
  width = 104,
  height = 30,
  color = SERIES[0],
}: {
  points: number[]
  width?: number
  height?: number
  color?: string
}): ReactElement | null {
  if (!points || points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const stepX = width / (points.length - 1)
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4)
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="trend">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** A small vertical-bar chart (e.g. cost per day). One bar per real datum. */
export function MiniBars({
  bars,
  width = 320,
  height = 96,
  color = SERIES[0],
}: {
  bars: { label: string; value: number }[]
  width?: number
  height?: number
  color?: string
}): ReactElement | null {
  if (!bars.length) return null
  const max = Math.max(...bars.map((b) => b.value), 1)
  const gap = 4
  const bw = (width - gap * (bars.length - 1)) / bars.length
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="bars">
      {bars.map((b, i) => {
        const h = Math.max(1, (b.value / max) * (height - 2))
        return (
          <rect key={b.label + i} x={i * (bw + gap)} y={height - h} width={bw} height={h} rx={2} fill={color} opacity={0.85}>
            <title>{`${b.label}: ${b.value}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

/** A donut from real slices (value > 0). The classic stroke-dasharray ring. */
export function Donut({
  slices,
  size = 168,
  thickness = 22,
}: {
  slices: { label: string; value: number; color: string }[]
  size?: number
  thickness?: number
}): ReactElement | null {
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (total <= 0) return null
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const cx = size / 2
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="distribution">
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={TRACK} strokeWidth={thickness} />
        {slices.map((s) => {
          const frac = s.value / total
          const seg = frac * c
          const el = (
            <circle
              key={s.label}
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${seg} ${c - seg}`}
              strokeDashoffset={-offset}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          )
          offset += seg
          return el
        })}
      </g>
      <text x={cx} y={cx - 4} textAnchor="middle" fontSize={22} fontWeight={800} fill="currentColor">
        {total}
      </text>
      <text x={cx} y={cx + 16} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.6}>
        GPUs
      </text>
    </svg>
  )
}

/** A thin horizontal utilization bar (0–100), tone by value. */
export function UtilBar({ value, width = 120 }: { value: number; width?: number }): ReactElement {
  const v = Math.max(0, Math.min(100, value))
  return (
    <svg width={width} height={8} viewBox={`0 0 ${width} 8`} role="img" aria-label={`${Math.round(v)}%`}>
      <rect x={0} y={1} width={width} height={6} rx={3} fill={TRACK} />
      <rect x={0} y={1} width={(v / 100) * width} height={6} rx={3} fill={utilColor(v)} />
    </svg>
  )
}

/** A legend row: color swatch + label + value. */
export function LegendDot({ color, label, value }: { color: string; label: string; value?: ReactNode }) {
  return (
    <XStack items="center" gap="$2" justify="space-between">
      <XStack items="center" gap="$2">
        <YStack width={10} height={10} rounded="$1" bg={color as never} />
        <Text fontSize="$2" color="$color11">
          {label}
        </Text>
      </XStack>
      {value != null ? (
        <Text fontSize="$2" color="$color12" fontWeight="600">
          {value}
        </Text>
      ) : null}
    </XStack>
  )
}

/**
 * One overview metric tile. `value` is pre-formatted by the caller (so an absent
 * metric is an honest `—`, never a fabricated number). The sparkline only appears
 * when the caller has a REAL series; the delta only when a real comparison exists.
 */
export function MetricCard({
  icon,
  label,
  value,
  caption,
  spark,
  sparkColor,
  delta,
}: {
  icon: ReactElement
  label: string
  value: string
  caption?: string
  spark?: number[]
  sparkColor?: string
  delta?: { pct: number }
}) {
  const up = delta ? delta.pct >= 0 : false
  return (
    <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" flex={1} minW={172}>
      <XStack items="center" gap="$2" justify="space-between">
        <XStack items="center" gap="$2">
          {icon}
          <Text fontSize="$2" color="$color11" fontWeight="600">
            {label}
          </Text>
        </XStack>
        {delta ? (
          <Text fontSize="$1" color={up ? '#7ee787' : '#e5534b'}>
            {up ? '▲' : '▼'} {Math.abs(delta.pct)}%
          </Text>
        ) : null}
      </XStack>
      <XStack items="flex-end" justify="space-between" gap="$2">
        <Text fontSize="$8" fontWeight="900" color="$color12" numberOfLines={1}>
          {value}
        </Text>
        {spark && spark.length >= 2 ? <Sparkline points={spark} color={sparkColor ?? SERIES[0]} /> : null}
      </XStack>
      {caption ? (
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </Card>
  )
}

/**
 * A button that is either a real action (onPress) or HONESTLY disabled with a native
 * tooltip explaining why (the action has no backend yet). One way to render the
 * "real route or honest-disabled" affordance the GPU surface uses everywhere.
 */
export function HintButton({
  icon,
  iconAfter,
  children,
  onPress,
  disabled,
  hint,
  theme,
}: {
  icon?: ReactElement
  iconAfter?: ReactElement
  children: ReactNode
  onPress?: () => void
  disabled?: boolean
  /** Native tooltip text (shown on hover) — say WHY it is disabled. */
  hint?: string
  theme?: 'light'
}) {
  const btn = (
    <Button
      size="$2"
      theme={theme}
      icon={icon}
      iconAfter={iconAfter}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
    >
      {children}
    </Button>
  )
  if (!hint) return btn
  return (
    <span title={hint} style={{ display: 'inline-flex' }}>
      {btn}
    </span>
  )
}

/** A titled panel wrapper used across the overview (chart cards). */
export function Panel({
  title,
  right,
  children,
  minW = 280,
}: {
  title: string
  right?: ReactNode
  children: ReactNode
  minW?: number
}) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={minW}>
      <XStack items="center" justify="space-between" gap="$2">
        <Text fontSize="$4" fontWeight="800" color="$color12">
          {title}
        </Text>
        {right}
      </XStack>
      {children}
    </Card>
  )
}
