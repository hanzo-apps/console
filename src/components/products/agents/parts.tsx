'use client'

/**
 * Shared presentational parts for the Agents dashboard — the status pill, the
 * version badge, the agent avatar, the health donut, the recent-activity feed, the
 * top-agents bar list, and the resource-usage panel. Built only on shared GUI
 * primitives + `ui/Charts`, so the board reads identically everywhere. No data is
 * produced here — every part renders REAL values passed in (or an honest "—").
 *
 * Style props use the @hanzo/gui v5 shorthand set (bg/p/px/py/gap/rounded/items/…).
 */
import type { ReactNode } from 'react'
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  ArrowUpRight,
  Bot,
  Cpu,
  DollarSign,
  HardDrive,
  MemoryStick,
  Pencil,
  RefreshCw,
  TriangleAlert,
} from '@hanzogui/lucide-icons-2'

import {
  AGENT_STATUSES,
  AGENT_STATUS_LABEL,
  fmtBytes,
  fmtCompact,
  fmtRelative,
  fmtUsd,
  fmtVersion,
  type Agent,
  type AgentActivity,
  type AgentActivityKind,
  type AgentResourceUsage,
  type AgentStatus,
} from '~/lib/api/agents'
import { Donut, BarRows, type Slice } from '~/components/ui/Charts'
import { toneVar, type Tone } from '~/components/ui/tone'
import { asColor } from '@hanzo/ui/product'

/** Status → tone — one source of truth for the pill dot + the health donut. */
export const STATUS_TONE: Record<AgentStatus, Tone> = {
  active: 'positive',
  idle: 'neutral',
  error: 'critical',
  draft: 'muted',
}

/** A colored status dot (inline SVG so the color is a raw hex matching the Donut). */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="5" fill={color} />
    </svg>
  )
}

/** A status pill — dot + canonical label. */
export function StatusPill({ status }: { status: AgentStatus }) {
  return (
    <XStack items="center" gap="$1.5">
      <Dot color={toneVar(STATUS_TONE[status])} />
      <Text fontSize="$2" color="$color12" numberOfLines={1}>
        {AGENT_STATUS_LABEL[status]}
      </Text>
    </XStack>
  )
}

/** A subtle version badge (`v1.4.2`). */
export function VersionBadge({ version }: { version?: string }) {
  return (
    <Text fontSize="$1" px="$1.5" py="$0.5" rounded="$3" bg="$color3" color="$color11" fontWeight="700">
      {fmtVersion(version)}
    </Text>
  )
}

/** The agent avatar tile — a rounded square with the Bot glyph. */
export function AgentAvatar({ size = 30 }: { size?: number }) {
  return (
    <YStack width={size} height={size} items="center" justify="center" rounded="$3" bg="$color4">
      <Bot size={Math.round(size * 0.56)} color="$color11" />
    </YStack>
  )
}

// ── Agent Health donut ────────────────────────────────────────────────────────

/** Agent Health — a donut of the four canonical status buckets + a legend. */
export function HealthDonut({ breakdown }: { breakdown: Record<AgentStatus, number> }) {
  const total = AGENT_STATUSES.reduce((n, s) => n + (breakdown[s] ?? 0), 0)
  const slices: Slice[] = AGENT_STATUSES.map((s) => ({
    label: AGENT_STATUS_LABEL[s],
    value: breakdown[s] ?? 0,
    color: toneVar(STATUS_TONE[s]),
  }))
  return (
    <YStack items="center" gap="$3">
      <Donut
        slices={slices}
        size={168}
        center={
          <YStack items="center">
            <Text fontSize="$8" fontWeight="900" color="$color12">
              {total}
            </Text>
            <Text fontSize="$1" color="$color10">
              agents
            </Text>
          </YStack>
        }
      />
      <YStack gap="$1.5" self="stretch">
        {slices.map((s) => (
          <XStack key={s.label} items="center" gap="$2">
            <Dot color={s.color as string} size={9} />
            <Text fontSize="$2" color="$color11" flex={1}>
              {s.label}
            </Text>
            <Text fontSize="$2" color="$color12" fontWeight="700">
              {s.value}
            </Text>
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}

// ── Recent Activity feed ───────────────────────────────────────────────────────

const ACTIVITY_META: Record<AgentActivityKind, { icon: typeof Activity; tone: Tone; verb: string }> = {
  invoked: { icon: Activity, tone: 'neutral', verb: 'invoked' },
  updated: { icon: Pencil, tone: 'muted', verb: 'updated' },
  failed: { icon: TriangleAlert, tone: 'critical', verb: 'failed' },
  scaled: { icon: ArrowUpRight, tone: 'warning', verb: 'scaled' },
  created: { icon: Bot, tone: 'positive', verb: 'created' },
  deployed: { icon: RefreshCw, tone: 'neutral', verb: 'deployed' },
}

/** One row of the Recent Activity feed. */
function ActivityRow({ e, now }: { e: AgentActivity; now: number }) {
  const meta = ACTIVITY_META[e.kind]
  const Icon = meta.icon
  return (
    <XStack gap="$2.5" items="flex-start" py="$1.5" borderBottomWidth={1} borderColor="$borderColor">
      <YStack width={26} height={26} items="center" justify="center" rounded="$10" bg="$color3">
        <Icon size={13} color={asColor(toneVar(meta.tone))} />
      </YStack>
      <YStack flex={1} minW={0} gap="$0.5">
        <Text fontSize="$2" color="$color12" numberOfLines={1}>
          <Text fontWeight="700">{e.agent}</Text> {e.message ?? meta.verb}
        </Text>
        <Text fontSize="$1" color="$color10">
          {fmtRelative(e.at, now)}
        </Text>
      </YStack>
    </XStack>
  )
}

/** The Recent Activity feed — REAL events, newest first, or an honest empty note. */
export function ActivityFeed({ events, now = Date.now() }: { events: AgentActivity[]; now?: number }) {
  if (!events.length) {
    return (
      <YStack height={180} items="center" justify="center" gap="$1">
        <Activity size={20} color="$color9" />
        <Text fontSize="$2" color="$color10" text="center" maxW={240}>
          Agent invocations, updates, and deploys appear here as they happen.
        </Text>
      </YStack>
    )
  }
  return (
    <YStack>
      {events.map((e) => (
        <ActivityRow key={e.id} e={e} now={now} />
      ))}
    </YStack>
  )
}

// ── Top Agents by invocations ─────────────────────────────────────────────────

/** A ranked bar list of the busiest agents (real invocation counts), or an em-dash. */
export function TopAgents({ agents }: { agents: Agent[] }) {
  const bars: Slice[] = agents.map((a) => ({ label: a.name, value: a.invocations30d ?? 0 }))
  if (!bars.length) {
    return (
      <YStack height={140} items="center" justify="center">
        <Text fontSize="$2" color="$color10" text="center" maxW={240}>
          Ranked by invocations once agents start running.
        </Text>
      </YStack>
    )
  }
  return <BarRows bars={bars} />
}

// ── Resource Usage 30d panel ───────────────────────────────────────────────────

function ResourceRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <XStack items="center" gap="$2.5" py="$2" borderBottomWidth={1} borderColor="$borderColor">
      <YStack width={26} height={26} items="center" justify="center" rounded="$3" bg="$color3">
        {icon}
      </YStack>
      <Text fontSize="$2" color="$color11" flex={1}>
        {label}
      </Text>
      <Text fontSize="$3" fontWeight="700" color="$color12">
        {value}
      </Text>
    </XStack>
  )
}

/**
 * The Resource Usage (30d) panel — CPU vCPU-h, Memory GB-h, Storage I/O, Cost. Each
 * field is REAL from the metrics rollup or an honest "—" when the metrics route
 * isn't connected. `connected` gates the honest footnote.
 */
export function ResourceUsagePanel({ usage, connected }: { usage: AgentResourceUsage; connected: boolean }) {
  const cpu = usage.cpuVcpuHours == null ? '—' : `${fmtCompact(usage.cpuVcpuHours)} vCPU·h`
  const mem = usage.memGbHours == null ? '—' : `${fmtCompact(usage.memGbHours)} GB·h`
  const io = fmtBytes(usage.storageIoBytes)
  const cost = fmtUsd(usage.costCents)
  return (
    <YStack gap="$1">
      <ResourceRow icon={<Cpu size={13} color="$color11" />} label="CPU" value={cpu} />
      <ResourceRow icon={<MemoryStick size={13} color="$color11" />} label="Memory" value={mem} />
      <ResourceRow icon={<HardDrive size={13} color="$color11" />} label="Storage I/O" value={io} />
      <ResourceRow icon={<DollarSign size={13} color="$color11" />} label="Cost" value={cost} />
      {!connected ? (
        <Text fontSize="$1" color="$color10" pt="$2">
          Resource metering connects when the Agents metrics route is live — shown as “—” until then.
        </Text>
      ) : null}
    </YStack>
  )
}

/** A titled dashboard card — the ONE panel wrapper the board composes. */
export function Panel({ title, action, children, flex = 1, minW = 260 }: { title: string; action?: ReactNode; children: ReactNode; flex?: number; minW?: number }) {
  return (
    <Card flex={flex} minW={minW} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <Text fontSize="$4" fontWeight="800" color="$color12">
          {title}
        </Text>
        {action}
      </XStack>
      {children}
    </Card>
  )
}
