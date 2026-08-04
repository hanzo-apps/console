'use client'

/**
 * Shared Sentry panel parts — the small chrome every panel reuses (period +
 * project pickers, search box, copy/code block, tag/level pills, fact rows). ONE
 * definition each (DRY) over @hanzo/gui shorthands, so the Sentry face is styled
 * exactly like the rest of the console (Hanzo design system, no upstream import).
 */
import { useState, type ReactNode } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Check, Copy, Search } from '@hanzogui/lucide-icons-2'

import { PERIODS, type Period, type SentryProject } from '~/lib/api/sentry'
import { toneColor } from '~/components/ui/tone'

/** A compact time-range button row (1h · 24h · 7d · …). */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <XStack gap="$1" flexWrap="wrap" items="center">
      {PERIODS.map((p) => (
        <Button
          key={p}
          size="$2"
          bg={p === value ? '$color5' : 'transparent'}
          borderWidth={1}
          borderColor="$borderColor"
          onPress={() => onChange(p)}
          aria-label={`Period ${p}`}
        >
          {p}
        </Button>
      ))}
    </XStack>
  )
}

const ALL_PROJECTS = 'All projects'

/** A project filter as a native select; '' = all projects. */
export function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: SentryProject[]
  value: string
  onChange: (slug: string) => void
}) {
  const names = projects.map((p) => p.slug || p.id)
  const options = [ALL_PROJECTS, ...names]
  const CHEVRON = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%239a9a9a%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E'
  return (
    <select
      value={value || ALL_PROJECTS}
      onChange={(e) => onChange(e.currentTarget.value === ALL_PROJECTS ? '' : e.currentTarget.value)}
      aria-label="Project"
      style={{
        appearance: 'none',
        WebkitAppearance: 'none',
        MozAppearance: 'none',
        background: `var(--background) url("${CHEVRON}") no-repeat right 8px center`,
        color: 'var(--color12)',
        border: '1px solid var(--borderColor)',
        borderRadius: 9,
        padding: '7px 30px 7px 10px',
        fontSize: 13,
        height: 34,
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o} value={o} style={{ background: 'var(--color2)', color: 'var(--color12)' }}>
          {o}
        </option>
      ))}
    </select>
  )
}

/** A search box that submits on Enter (and live-updates `value`). */
export function SearchInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search…',
}: {
  value: string
  onChange: (v: string) => void
  onSubmit?: () => void
  placeholder?: string
}) {
  return (
    <XStack items="center" gap="$2" borderWidth={1} borderColor="$borderColor" rounded="$3" px="$2.5" flex={1} minW={180} bg="$color1">
      <Search size={15} color="var(--color10)" />
      <Input
        flex={1}
        unstyled
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        autoCapitalize="none"
        color="$color12"
        fontSize="$3"
        height={36}
        onKeyPress={(e: { nativeEvent: { key: string } }) => {
          if (e.nativeEvent.key === 'Enter' && onSubmit) onSubmit()
        }}
      />
    </XStack>
  )
}

/** Copy-to-clipboard button with a transient check. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      })
    }
  }
  return (
    <Button size="$2" chromeless icon={done ? <Check size={14} color={toneColor('positive')} /> : <Copy size={14} />} onPress={copy}>
      {done ? 'Copied' : label}
    </Button>
  )
}

/** A monospace code block with a copy affordance (DSN, SDK snippet). */
export function CodeBlock({ code, title }: { code: string; title?: string }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" bg="$color1" overflow="hidden">
      <XStack items="center" justify="space-between" px="$3" py="$2" borderBottomWidth={1} borderColor="$borderColor" bg="$color2">
        <Text fontSize="$2" color="$color11" fontWeight="500">
          {title ?? 'Snippet'}
        </Text>
        <CopyButton text={code} />
      </XStack>
      <YStack p="$3" style={{ overflowX: 'auto' }}>
        <Text className="mono" fontSize="$2" color="$color12" style={{ whiteSpace: 'pre', display: 'block' }}>
          {code}
        </Text>
      </YStack>
    </Card>
  )
}

/** A rounded chip: a colored dot + label (level, status, environment, tag). */
export function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <XStack borderWidth={1} borderColor="$borderColor" rounded="$10" px="$2.5" py="$1" items="center" gap="$1.5">
      <YStack width={7} height={7} rounded="$10" style={{ backgroundColor: tone }} />
      <Text fontSize="$1" color="$color11">
        {label}
      </Text>
    </XStack>
  )
}

/** A label-over-value fact cell (mono value). */
export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <YStack gap="$0.5" minW={96}>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      {typeof value === 'string' ? (
        <Text fontSize="$2" color="$color12" className="mono">
          {value}
        </Text>
      ) : (
        value
      )}
    </YStack>
  )
}
