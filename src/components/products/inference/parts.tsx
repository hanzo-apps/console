'use client'

/**
 * Inference UI atoms — the shared dark-card / purple-accent language reused across
 * the main endpoints dashboard and the Status / Logs sub-pages. Strictly @hanzo/gui
 * v5 shorthands; every trend is the real `Sparkline` (renders nothing for <2 points,
 * never a fabricated line) and every metric renders an honest em-dash for absent data.
 */
import type { ComponentProps, ReactNode } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { TrendingDown, TrendingUp } from '@hanzogui/lucide-icons-2'

import { Sparkline } from '~/components/ui/Charts'
import { fmtDelta } from './logic'

// `Segmented` / `SearchInput` / `Option` were promoted to `ui/Filters` so sibling
// products share ONE definition; re-exported here so every existing importer of
// `./parts` is unchanged.
export { Segmented, SearchInput, type Option } from '~/components/ui/Filters'

/** The console's purple accent (shared with the chart palette). */
export const ACCENT = '#7c5cff'

/** The one purple, high-emphasis action (the mockup's "+ Deploy Endpoint"). The dark
 *  theme's default button label/icon is light, which reads on the purple fill. */
export function AccentButton(props: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      borderWidth={1}
      style={{ backgroundColor: ACCENT, borderColor: ACCENT, color: '#fff' }}
      hoverStyle={{ opacity: 0.92 }}
      pressStyle={{ opacity: 0.85 }}
    />
  )
}

/** A titled dark card — the ONE section container across the dashboard. */
export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  p = '$4',
  ...rest
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  p?: ComponentProps<typeof Card>['p']
} & Omit<ComponentProps<typeof Card>, 'children' | 'title'>) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" bg="$color2" rounded="$5" p={p} gap="$3.5" {...rest}>
      {title || actions ? (
        <XStack justify="space-between" items="center" gap="$3" flexWrap="wrap">
          <YStack gap="$0.5">
            {title ? (
              <Text fontSize="$5" fontWeight="800" color="$color12">
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text fontSize="$2" color="$color10">
                {subtitle}
              </Text>
            ) : null}
          </YStack>
          {actions ? <XStack gap="$2" items="center">{actions}</XStack> : null}
        </XStack>
      ) : null}
      {children}
    </Card>
  )
}

/** A colored status dot (from the phase→color map). */
export function StatusDot({ color, size = 9 }: { color: string; size?: number }) {
  return <YStack width={size} height={size} rounded="$10" style={{ backgroundColor: color }} />
}

/** An ↑/↓ delta chip. Up→green, down→red, null→muted em-dash. Direction only (honest). */
export function DeltaChip({ pct }: { pct: number | null }) {
  if (pct == null || !Number.isFinite(pct)) {
    return (
      <Text fontSize="$1" color="$color10">
        —
      </Text>
    )
  }
  const up = Math.round(pct) >= 0
  const color = up ? '#23c562' : '#ff5d8f'
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <XStack items="center" gap="$1">
      <Icon size={13} color={color} />
      <Text fontSize="$1" fontWeight="700" style={{ color }}>
        {fmtDelta(pct)}
      </Text>
    </XStack>
  )
}

/**
 * A KPI stat — label, big value, optional delta + inline sparkline. Renders whatever
 * the caller passes (already honest: "—" for absent, a real number otherwise).
 */
export function MetricStat({
  label,
  value,
  delta,
  series,
  icon,
}: {
  label: string
  value: string
  delta?: number | null
  series?: number[]
  icon?: ReactNode
}) {
  return (
    // NOTE: no `flex={1}` — these stack vertically inside the Usage Overview card, and
    // a flex child with flex-basis:0 collapses to zero height in an auto-height column,
    // which made the label overlap the value. Content-sized rows keep them separated.
    <YStack gap="$1.5" minW={130}>
      <XStack items="center" justify="space-between" gap="$2">
        <Text fontSize="$2" color="$color10">
          {label}
        </Text>
        {icon ?? null}
      </XStack>
      <Text fontSize="$7" fontWeight="800" color="$color12" numberOfLines={1}>
        {value}
      </Text>
      {delta !== undefined || (series && series.length) ? (
        <XStack items="center" justify="space-between" gap="$2">
          {delta !== undefined ? <DeltaChip pct={delta ?? null} /> : <YStack />}
          {series && series.length ? <Sparkline values={series} width={70} height={22} color={ACCENT} /> : null}
        </XStack>
      ) : null}
    </YStack>
  )
}

/** A per-endpoint mini sparkline (real series) with an honest em-dash fallback. */
export function MiniSparkline({ series }: { series: number[] }) {
  if (!series || series.filter((v) => Number.isFinite(v)).length < 2) {
    return (
      <Text fontSize="$2" color="$color9">
        —
      </Text>
    )
  }
  return <Sparkline values={series} width={96} height={26} color={ACCENT} />
}

/** A right-aligned metric cell for the endpoint row (value + caption), honest "—". */
export function CellStat({ value, caption }: { value: string; caption?: string }) {
  return (
    <YStack gap="$0.5">
      <Text fontSize="$3" fontWeight="700" color="$color12">
        {value}
      </Text>
      {caption ? (
        <Text fontSize="$1" color="$color9">
          {caption}
        </Text>
      ) : null}
    </YStack>
  )
}

/**
 * The purple 3D-ish graphic accent for the hero card — pure SVG (concentric rings +
 * a glowing orb + a stylized cube), tinted with the accent. No bespoke render / asset
 * dependency; decorative only (aria-hidden), and it scales down on narrow viewports.
 */
export function HeroGraphic({ size = 190 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden style={{ display: 'block', maxWidth: '100%' }}>
      <defs>
        <radialGradient id="hz-inf-glow" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.55" />
          <stop offset="55%" stopColor={ACCENT} stopOpacity="0.14" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hz-inf-cube" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor={ACCENT} />
        </linearGradient>
      </defs>
      <circle cx="100" cy="96" r="92" fill="url(#hz-inf-glow)" />
      {[74, 56, 40].map((r, i) => (
        <circle key={r} cx="100" cy="96" r={r} fill="none" stroke={ACCENT} strokeOpacity={0.18 + i * 0.12} strokeWidth={1.5} />
      ))}
      {/* an isometric cube — the "serving unit" motif */}
      <g transform="translate(100 96)">
        <polygon points="0,-34 30,-17 30,17 0,34 -30,17 -30,-17" fill="url(#hz-inf-cube)" fillOpacity="0.9" />
        <polygon points="0,-34 30,-17 0,0 -30,-17" fill="#c4b5fd" fillOpacity="0.85" />
        <polygon points="0,0 30,-17 30,17 0,34" fill={ACCENT} fillOpacity="0.7" />
        <polygon points="0,0 -30,-17 -30,17 0,34" fill="#6d28d9" fillOpacity="0.7" />
      </g>
    </svg>
  )
}
