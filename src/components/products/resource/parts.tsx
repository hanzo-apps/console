'use client'

/**
 * Presentational parts for the managed-resource console — self-contained,
 * data-prop-driven (no transport), so they lift cleanly into `@hanzo/ui`. Built
 * on @hanzo/gui shorthand style props (v5 config). Every "absent" value renders
 * an honest "—" rather than a fabricated number.
 */
import { useState, type ReactElement, type ReactNode } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  Boxes,
  Database,
  FileText,
  HardDrive,
  Key,
  Search,
  Server,
  Terminal,
} from '@hanzogui/lucide-icons-2'

import { CopyButton } from '~/components/ui/CopyButton'
import { Donut } from '~/components/ui/Charts'
import type { Slice } from '~/components/ui/Charts'
import type { ProductIcon } from '~/lib/products/registry'
import type { Snippet } from './logic'

/** Resolve a spec's icon key to a component (keeps `logic.ts` pure/iconless). */
const ICONS: Record<string, ProductIcon> = {
  Database,
  Key,
  Server,
  HardDrive,
  Boxes,
  FileText,
  Search,
  Terminal,
}
/** The icon component for a key (e.g. for EmptyState's `icon` prop). */
export const iconComponent = (key: string): ProductIcon => ICONS[key] ?? Database

/** Open an external URL in a new tab (no-opener), guarded for SSR. */
export const openHref = (href: string): void => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}
/** A ready-to-render icon element for a key. */
export function iconFor(key: string, size = 16): ReactElement {
  const Icon = iconComponent(key)
  return <Icon size={size} />
}

/**
 * A unified stat tile. A `null` value is an honest gap — it renders "—" with an
 * "Awaiting metering" note, never a placeholder number. Mirrors the shipped
 * aimetrics StatTile look so every board reads the same.
 */
export function ResourceStat({
  label,
  value,
  sub,
  icon,
  loading,
}: {
  label: string
  /** Formatted value, or `null` for an honest "—". */
  value: string | null
  sub?: string
  icon?: ReactNode
  loading?: boolean
}) {
  const absent = value == null
  return (
    <Card flex={1} minW={170} p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color1">
      <XStack items="center" gap="$2">
        {icon ? <YStack opacity={0.7}>{icon}</YStack> : null}
        <Text fontSize="$2" color="$color10">
          {label}
        </Text>
      </XStack>
      {loading ? (
        <XStack height={34} items="center">
          <Spinner color="$color11" />
        </XStack>
      ) : (
        <Text fontSize="$8" fontWeight="800" color={absent ? '$color10' : '$color12'}>
          {absent ? '—' : value}
        </Text>
      )}
      <Text fontSize="$1" color="$color10" numberOfLines={1}>
        {loading ? ' ' : (sub ?? (absent ? 'Awaiting metering' : ' '))}
      </Text>
    </Card>
  )
}

/** A titled card wrapper — the one section primitive for the console. */
export function SectionCard({
  title,
  actions,
  children,
  flex,
  minW,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
  flex?: number
  minW?: number
}) {
  return (
    <Card flex={flex} minW={minW} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack justify="space-between" items="center" gap="$2">
        <Text fontSize="$5" fontWeight="800" color="$color12">
          {title}
        </Text>
        {actions}
      </XStack>
      {children}
    </Card>
  )
}

/** A label/value row in a detail/overview list. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <XStack justify="space-between" items="center" py="$2" borderBottomWidth={1} borderColor="$borderColor" gap="$3">
      <Text fontSize="$3" color="$color11" fontWeight="600">
        {label}
      </Text>
      <Text fontSize="$3" color="$color12" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

/** Generic tab bar — id/label/icon triples, one active. Mirrors EmbeddingsModule. */
export type TabDef = { id: string; label: string; icon: ReactElement }
export function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: TabDef[]
  active: string
  onSelect: (id: string) => void
}) {
  return (
    <XStack gap="$1.5" flexWrap="wrap">
      {tabs.map((t) => (
        <Button
          key={t.id}
          size="$2"
          icon={t.icon}
          bg={active === t.id ? '$color5' : 'transparent'}
          borderWidth={1}
          borderColor="$borderColor"
          onPress={() => onSelect(t.id)}
        >
          {t.label}
        </Button>
      ))}
    </XStack>
  )
}

/** A monospace-ish value box with copy, and optional masked reveal for secrets. */
export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret)
  const masked = '•'.repeat(Math.min(value.length, 32))
  return (
    <YStack gap="$1.5">
      <Text fontSize="$2" fontWeight="700" color="$color11">
        {label}
      </Text>
      <XStack gap="$2" items="center">
        <Text
          flex={1}
          fontSize="$3"
          px="$3"
          py="$2"
          bg="$color2"
          rounded="$3"
          borderWidth={1}
          borderColor="$borderColor"
          numberOfLines={1}
        >
          {shown ? value : masked}
        </Text>
        {secret ? (
          <Button size="$2" onPress={() => setShown((v) => !v)}>
            {shown ? 'Hide' : 'Show'}
          </Button>
        ) : null}
        <CopyButton value={value} size="$2" chromeless={false} ariaLabel={`Copy ${label}`} />
      </XStack>
    </YStack>
  )
}

/** A copy-pastable quick-start snippet (title + code). Real contract text only. */
export function SnippetBlock({ snippet }: { snippet: Snippet }) {
  return (
    <YStack gap="$2">
      <XStack justify="space-between" items="center">
        <Text fontSize="$2" fontWeight="700" color="$color11">
          {snippet.title}
        </Text>
        <CopyButton value={snippet.code} size="$1" ariaLabel={`Copy ${snippet.title}`} />
      </XStack>
      <YStack px="$3" py="$2.5" bg="$color2" rounded="$3" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$2" color="$color12" selectable style={{ fontFamily: 'monospace' }}>
          {snippet.code}
        </Text>
      </YStack>
    </YStack>
  )
}

/** The status donut card (real breakdown) — only rendered when there is a fleet. */
export function StatusDonutCard({ slices, total }: { slices: Slice[]; total: number }) {
  return (
    <SectionCard title="Status" flex={1} minW={260}>
      <Donut
        slices={slices}
        legend
        center={
          <YStack items="center">
            <Text fontSize="$7" fontWeight="900" color="$color12">
              {total}
            </Text>
            <Text fontSize="$1" color="$color10">
              total
            </Text>
          </YStack>
        }
      />
    </SectionCard>
  )
}
