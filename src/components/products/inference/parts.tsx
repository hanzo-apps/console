'use client'

/**
 * Inference UI atoms — the shared dark-card / MONOCHROME-accent language reused across
 * the main endpoints dashboard and the Status / Logs sub-pages. Strictly @hanzo/gui
 * v5 shorthands; every trend is the real `Sparkline` (renders nothing for <2 points,
 * never a fabricated line) and every metric renders an honest em-dash for absent data.
 */
import type { ComponentProps, ReactNode } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Search, TrendingDown, TrendingUp } from '@hanzogui/lucide-icons-2'

import { Sparkline } from '~/components/ui/Charts'
import { asColor } from '~/components/ui/color'
import { toneVar } from '~/components/ui/tone'
import { RAMP } from '~/lib/theme/ramp'
import { fmtDelta } from './logic'

/** The console's monochrome accent — the lead step of the shared categorical scale. */
export const ACCENT = RAMP[1]

/** The ONE high-emphasis action (the mockup's "+ Deploy Endpoint") — a monochrome
 *  white-on-black primary (design --primary / --primary-foreground), theme-aware via
 *  the Tamagui token ladder: near-white fill + inverted label in dark, inverting in
 *  light. No hue: the primary is emphasis, not color. */
export function AccentButton(props: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      borderWidth={1}
      // Theme-aware monochrome primary via CSS vars (forwarded to the DOM on web):
      // near-white fill + inverted label in dark, inverting in light. --color12 /
      // --background are the console's design-derived Tamagui theme tokens.
      style={{ backgroundColor: 'var(--color12)', borderColor: 'var(--color12)', color: 'var(--background)' }}
      hoverStyle={{ opacity: 0.9 }}
      pressStyle={{ opacity: 0.82 }}
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

/** One pill in a segmented control. */
export type Option<T extends string> = { label: string; value: T }

/** A compact segmented pill control — the ONE way filters/ranges/toggles render. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = '$2',
}: {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  size?: ComponentProps<typeof Button>['size']
}) {
  return (
    <XStack gap="$1" flexWrap="wrap" items="center">
      {options.map((o) => {
        const active = o.value === value
        return (
          <Button
            key={o.value}
            size={size}
            bg={active ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor={active ? '$color7' : '$borderColor'}
            onPress={() => onChange(o.value)}
          >
            <Text fontSize="$2" fontWeight={active ? '700' : '500'} color={active ? '$color12' : '$color11'}>
              {o.label}
            </Text>
          </Button>
        )
      })}
    </XStack>
  )
}

/** A search input with a leading magnifier. */
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <XStack
      flex={1}
      minW={180}
      items="center"
      gap="$2"
      px="$3"
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$4"
      bg="$color1"
    >
      <Search size={15} color="$color10" />
      <Input
        flex={1}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        borderWidth={0}
        bg="transparent"
        px="$0"
        fontSize="$3"
      />
    </XStack>
  )
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
  // Direction is carried by the icon; colour only weights it (the one tone map).
  const color = toneVar(up ? 'positive' : 'critical')
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <XStack items="center" gap="$1">
      <Icon size={13} color={asColor(color)} />
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
 * The monochrome 3D-ish graphic accent for the hero card — pure SVG (concentric rings +
 * a glowing orb + a stylized cube), tinted with the neutral accent + design neutral
 * ladder. No bespoke render / asset dependency; decorative only (aria-hidden), and it
 * scales down on narrow viewports.
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
          <stop offset="0%" stopColor={RAMP[0]} />
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
        <polygon points="0,-34 30,-17 0,0 -30,-17" fill={RAMP[0]} fillOpacity="0.85" />
        <polygon points="0,0 30,-17 30,17 0,34" fill={ACCENT} fillOpacity="0.7" />
        <polygon points="0,0 -30,-17 -30,17 0,34" fill={RAMP[6]} fillOpacity="0.7" />
      </g>
    </svg>
  )
}
