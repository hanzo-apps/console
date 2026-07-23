'use client'

/**
 * Tracker presentational atoms — the tiny, reusable marks shared by every tracker
 * view (list rows, board cards, the detail pane). Pure @hanzo/gui v5 shorthands, no
 * state, no network. Colors come from `logic.ts` token maps (as-const so the literal
 * satisfies the GUI color union), so a status/priority reads the same everywhere.
 */
import { Text, XStack, YStack } from '@hanzo/gui'
import {
  CircleDashed,
  Circle,
  CircleDot,
  CircleCheck,
  CircleSlash,
  GitPullRequest,
  Layers,
  Bot,
  Github,
  SignalHigh,
  SignalMedium,
  SignalLow,
  AlertTriangle,
  Minus,
} from '@hanzogui/lucide-icons-2'
import { type Status, type Priority, type Kind, type Source } from '~/lib/api/tracker'
import {
  STATUS_LABEL,
  STATUS_DOT,
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  KIND_LABEL,
  SOURCE_LABEL,
} from './logic'

// @hanzogui/lucide-icons-2 icons are Tamagui-wrapped: they accept a `color` token
// (e.g. "$red10") + `size`, exactly like DashboardShell's `<ChevronRight color=…/>`.
// `typeof Circle` IS that icon type, so a token color prop type-checks (a plain
// `string` would not — the color prop is a ColorToken union, not string).
type Glyph = typeof Circle

// ── Status ───────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<Status, Glyph> = {
  backlog: CircleDashed,
  todo: Circle,
  in_progress: CircleDot,
  done: CircleCheck,
  canceled: CircleSlash,
}

/** The colored status glyph (Linear's leading state icon). */
export function StatusIcon({ status, size = 15 }: { status: Status; size?: number }) {
  const Icon = STATUS_ICON[status]
  return <Icon size={size} color={STATUS_DOT[status]} />
}

/** A small round status dot (used where a full glyph is too heavy). */
export function StatusDot({ status, size = 9 }: { status: Status; size?: number }) {
  return <YStack width={size} height={size} rounded="$10" bg={STATUS_DOT[status]} />
}

export function StatusLabel({ status }: { status: Status }) {
  return (
    <XStack items="center" gap="$1.5">
      <StatusIcon status={status} />
      <Text fontSize="$2" color="$color11">
        {STATUS_LABEL[status]}
      </Text>
    </XStack>
  )
}

// ── Priority ─────────────────────────────────────────────────────────────────

const PRIORITY_ICON: Record<Priority, Glyph> = {
  urgent: AlertTriangle,
  high: SignalHigh,
  medium: SignalMedium,
  low: SignalLow,
  none: Minus,
}

/** The priority bars glyph (urgent = alert), colored per level. */
export function PriorityIcon({ priority, size = 15 }: { priority: Priority; size?: number }) {
  const Icon = PRIORITY_ICON[priority]
  return <Icon size={size} color={PRIORITY_COLOR[priority]} />
}

export function PriorityTag({ priority }: { priority: Priority }) {
  if (priority === 'none') {
    return (
      <Text fontSize="$2" color="$color9">
        —
      </Text>
    )
  }
  return (
    <XStack items="center" gap="$1.5">
      <PriorityIcon priority={priority} size={13} />
      <Text fontSize="$1" color="$color11" fontWeight="500">
        {PRIORITY_LABEL[priority]}
      </Text>
    </XStack>
  )
}

// ── Kind / Source badges ─────────────────────────────────────────────────────

const KIND_ICON: Record<Kind, Glyph> = {
  issue: Circle,
  pr: GitPullRequest,
  epic: Layers,
}

/** A kind glyph — a PR/epic reads distinctly from a plain issue. */
export function KindIcon({ kind, size = 14 }: { kind: Kind; size?: number }) {
  const Icon = KIND_ICON[kind]
  // Inline so the literal color token type-checks against the icon's ColorToken prop.
  return <Icon size={size} color={kind === 'pr' ? '$green10' : kind === 'epic' ? '$purple10' : '$color9'} />
}

/** A source chip — GitHub / Agent get their mark; team is quiet. */
export function SourceBadge({ source }: { source: Source }) {
  if (source === 'team') return null
  const Icon: Glyph = source === 'git' ? Github : source === 'agent' ? Bot : Circle
  return (
    <XStack items="center" gap="$1" px="$1.5" py="$0.5" rounded="$2" bg="$color3">
      <Icon size={11} color="$color10" />
      <Text fontSize="$1" color="$color10" fontWeight="600">
        {SOURCE_LABEL[source]}
      </Text>
    </XStack>
  )
}

// ── Labels / assignee / meta ─────────────────────────────────────────────────

export function LabelChips({ labels, max = 3 }: { labels: string[]; max?: number }) {
  if (labels.length === 0) return null
  const shown = labels.slice(0, max)
  const extra = labels.length - shown.length
  return (
    <XStack gap="$1" flexWrap="wrap" items="center">
      {shown.map((l) => (
        <XStack key={l} items="center" gap="$1" px="$1.5" py="$0.5" rounded="$10" bg="$color3">
          <YStack width={6} height={6} rounded="$10" bg="$color9" />
          <Text fontSize="$1" color="$color11" numberOfLines={1}>
            {l}
          </Text>
        </XStack>
      ))}
      {extra > 0 ? (
        <Text fontSize="$1" color="$color9">
          +{extra}
        </Text>
      ) : null}
    </XStack>
  )
}

/** A small round identity chip — initials on a tinted tile. */
export function Avatar({ name, size = 20 }: { name?: string; size?: number }) {
  const label = (name ?? '').trim()
  if (!label) {
    return (
      <YStack
        width={size}
        height={size}
        rounded="$10"
        borderWidth={1}
        borderColor="$color6"
        borderStyle="dashed"
      />
    )
  }
  const initials = (label.split(/[\s@._-]+/).map((w) => w[0]).join('').slice(0, 2) || 'U').toUpperCase()
  return (
    <XStack width={size} height={size} items="center" justify="center" rounded="$10" bg="$color5">
      <Text fontSize={Math.round(size * 0.42)} fontWeight="800" color="$color12">
        {initials}
      </Text>
    </XStack>
  )
}

/** A mono identifier tag (ENG-12). */
export function Identifier({ id, muted }: { id: string; muted?: boolean }) {
  return (
    <Text className="hz-mono" fontSize="$1" color={muted ? '$color9' : '$color10'} numberOfLines={1}>
      {id}
    </Text>
  )
}

/** A thin progress bar (done / total) — used by Cycles + Roadmap. */
export function ProgressBar({ value, width = 120 }: { value: number; width?: number }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <YStack width={width} height={6} rounded="$10" bg="$color4" overflow="hidden">
      <YStack height={6} rounded="$10" bg={pct >= 1 ? '$green10' : '$color11'} width={`${pct * 100}%`} />
    </YStack>
  )
}
