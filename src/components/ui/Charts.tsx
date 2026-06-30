'use client'

/**
 * Tiny, dependency-free charts — the ONE way the console draws a trend, a share,
 * or a distribution. Monochrome by design (the console's brand): every mark is a
 * single foreground token at a varying opacity, so the chart adapts to dark/light
 * with no per-theme palette.
 *
 * Honest by construction: a `Sparkline` with fewer than two points renders
 * nothing (no invented trend line); `Donut`/`BarChart` with no positive values
 * render an em-dash. Callers pass REAL series — these never fabricate data.
 *
 * SVG marks can't read Tamagui style tokens, so we resolve concrete colors from
 * the live theme (`useTheme().<token>.get()` → `var(--token)` on web, which stays
 * reactive to the theme) and hand them to `stroke`/`fill`.
 */
import { Text, XStack, YStack, useTheme } from '@hanzo/gui'

type Themed = ReturnType<typeof useTheme>

/** Read a concrete color for a theme token (for SVG), with a safe fallback. */
const tone = (theme: Themed, key: string, fallback: string): string => {
  const v = (theme as unknown as Record<string, { get?: () => unknown } | undefined>)[key]
  const got = v?.get?.()
  return typeof got === 'string' ? got : fallback
}

/** Opacity ramp so N monochrome slices/areas stay visually distinct. */
const rampOpacity = (i: number, n: number): number =>
  n <= 1 ? 0.9 : 0.95 - (i / (n - 1)) * 0.62

/**
 * A compact trend line. Renders only with ≥2 points — a single sample is not a
 * trend, so it draws nothing rather than a flat fake.
 */
export function Sparkline({
  values,
  width = 104,
  height = 30,
}: {
  values: number[]
  width?: number
  height?: number
}) {
  const theme = useTheme()
  const stroke = tone(theme, 'color11', 'currentColor')
  if (!values || values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const stepX = width / (values.length - 1)
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2)
  const line = values.map((v, i) => `${(i * stepX).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `0,${height} ${line} ${width.toFixed(2)},${height}`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline points={area} fill={stroke} fillOpacity={0.1} stroke="none" />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeOpacity={0.85}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** One labelled magnitude for `Donut`/`BarChart`. */
export type Slice = { label: string; value: number; hint?: string }

/**
 * A donut of shares with a center total and a side legend. Slices are the same
 * foreground token at decreasing opacity (monochrome, on-brand). With no positive
 * total it renders an honest em-dash instead of an empty ring.
 */
export function Donut({
  slices,
  size = 132,
  thickness = 18,
  centerLabel,
}: {
  slices: Slice[]
  size?: number
  thickness?: number
  centerLabel?: string
}) {
  const theme = useTheme()
  const fg = tone(theme, 'color12', 'currentColor')
  const positive = slices.filter((s) => s.value > 0)
  const total = positive.reduce((a, s) => a + s.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const cx = size / 2

  if (total <= 0) {
    return (
      <XStack items="center" justify="center" height={size}>
        <Text fontSize="$6" color="$color10">
          —
        </Text>
      </XStack>
    )
  }

  let offset = 0
  const arcs = positive.map((s, i) => {
    const len = (s.value / total) * c
    const el = (
      <circle
        key={s.label}
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke={fg}
        strokeOpacity={rampOpacity(i, positive.length)}
        strokeWidth={thickness}
        strokeDasharray={`${len.toFixed(2)} ${(c - len).toFixed(2)}`}
        strokeDashoffset={(-offset).toFixed(2)}
        transform={`rotate(-90 ${cx} ${cx})`}
      />
    )
    offset += len
    return el
  })

  return (
    <XStack gap="$4" items="center" flexWrap="wrap">
      <YStack width={size} height={size}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke={fg} strokeOpacity={0.08} strokeWidth={thickness} />
          {arcs}
          {centerLabel ? (
            <text x={cx} y={cx} textAnchor="middle" dominantBaseline="central" fontSize={15} fontWeight={700} fill={fg}>
              {centerLabel}
            </text>
          ) : null}
        </svg>
      </YStack>
      <YStack gap="$1.5" flex={1} minW={150}>
        {positive.map((s, i) => (
          <XStack key={s.label} gap="$2" items="center">
            <YStack width={10} height={10} rounded="$1" bg="$color12" opacity={rampOpacity(i, positive.length)} />
            <Text fontSize="$2" color="$color11" flex={1} numberOfLines={1}>
              {s.label}
            </Text>
            <Text fontSize="$2" color="$color12" fontWeight="600">
              {Math.round((s.value / total) * 100)}%
            </Text>
          </XStack>
        ))}
      </YStack>
    </XStack>
  )
}

/**
 * A horizontal bar distribution — token-native (no SVG), each bar a fraction of
 * the max. Honest em-dash when every value is zero/absent.
 */
export function BarChart({ bars }: { bars: Slice[] }) {
  const max = Math.max(0, ...bars.map((b) => b.value))
  if (max <= 0) {
    return (
      <Text fontSize="$3" color="$color10">
        —
      </Text>
    )
  }
  return (
    <YStack gap="$2.5">
      {bars.map((b) => (
        <XStack key={b.label} gap="$3" items="center">
          <Text width={64} fontSize="$2" color="$color11" text="right">
            {b.label}
          </Text>
          <YStack flex={1} height={10} bg="$color3" rounded="$2" overflow="hidden">
            <YStack height={10} width={`${Math.max(2, (b.value / max) * 100)}%`} bg="$color9" rounded="$2" />
          </YStack>
          <Text width={56} fontSize="$2" color="$color12" fontWeight="600">
            {b.value.toLocaleString()}
          </Text>
        </XStack>
      ))}
    </YStack>
  )
}
