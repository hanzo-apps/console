'use client'

/**
 * Span tree — the nested waterfall view of a trace's observations.
 *
 * The flat observations table loses the call structure; this renders the REAL
 * parent/child hierarchy carried on each observation (`parentObservationId`) as
 * an indented, collapsible tree, with a proportional timeline bar per span so the
 * latency waterfall reads at a glance. Built only on GUI Stacks (no graph/chart
 * dependency) — positions are computed from the observations' own start/end
 * times, so nothing is fabricated. Orphans and any parent cycles are surfaced as
 * top-level rows rather than dropped, so every observation appears exactly once.
 */
import { useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronDown, ChevronRight } from '@hanzogui/lucide-icons-2'

import type { Observation } from '~/lib/api'
import { Badge } from './parts'
import { elapsed, fmtLatency } from './format'

type SpanNode = { obs: Observation; depth: number; children: SpanNode[] }

const startMs = (o: Observation): number => new Date(o.startTime).getTime()
const endMs = (o: Observation): number => (o.endTime ? new Date(o.endTime).getTime() : startMs(o))

/**
 * Build the observation forest from `parentObservationId`. A parent ref pointing
 * outside this trace's set is treated as a root; orphans/cycles are appended as
 * roots after the reachable tree so nothing is dropped or loops forever.
 */
function buildForest(observations: Observation[]): SpanNode[] {
  const ids = new Set(observations.map((o) => o.id))
  const childrenOf = new Map<string | null, Observation[]>()
  for (const o of observations) {
    const key = o.parentObservationId && ids.has(o.parentObservationId) ? o.parentObservationId : null
    const arr = childrenOf.get(key)
    if (arr) arr.push(o)
    else childrenOf.set(key, [o])
  }
  const byStart = (a: Observation, b: Observation): number => startMs(a) - startMs(b)
  const seen = new Set<string>()
  const build = (o: Observation, depth: number): SpanNode => {
    seen.add(o.id)
    const kids = (childrenOf.get(o.id) ?? []).filter((c) => !seen.has(c.id)).sort(byStart)
    return { obs: o, depth, children: kids.map((c) => build(c, depth + 1)) }
  }
  const roots = (childrenOf.get(null) ?? []).sort(byStart).map((o) => build(o, 0))
  for (const o of observations.filter((x) => !seen.has(x.id)).sort(byStart)) roots.push(build(o, 0))
  return roots
}

/** Inclusive [start, end] window across all observations (ms). */
function window(observations: Observation[]): { start: number; span: number } {
  let start = Infinity
  let end = -Infinity
  for (const o of observations) {
    const s = startMs(o)
    const e = endMs(o)
    if (Number.isFinite(s)) start = Math.min(start, s)
    if (Number.isFinite(e)) end = Math.max(end, e)
  }
  if (!Number.isFinite(start)) return { start: 0, span: 0 }
  return { start, span: Math.max(end - start, 0) }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

/** One proportional timeline bar for a span, positioned within the trace window. */
function Waterfall({ obs, win }: { obs: Observation; win: { start: number; span: number } }) {
  const total = win.span || 1
  const left = clamp(((startMs(obs) - win.start) / total) * 100, 0, 100)
  const width = clamp(((endMs(obs) - startMs(obs)) / total) * 100, 0.75, 100 - left)
  return (
    <YStack flex={1} height={10} bg="$color3" rounded="$2" position="relative" overflow="hidden">
      <YStack
        position="absolute"
        t={0}
        b={0}
        l={`${left}%`}
        width={`${width}%`}
        bg="$color9"
        rounded="$2"
      />
    </YStack>
  )
}

function SpanRow({
  node,
  win,
  collapsed,
  onToggle,
}: {
  node: SpanNode
  win: { start: number; span: number }
  collapsed: Set<string>
  onToggle: (id: string) => void
}) {
  const { obs, depth, children } = node
  const hasChildren = children.length > 0
  const isCollapsed = collapsed.has(obs.id)
  return (
    <>
      <XStack
        items="center"
        gap="$2"
        py="$1.5"
        px="$2"
        borderTopWidth={1}
        borderColor="$borderColor"
        hoverStyle={{ bg: '$color2' }}
      >
        <XStack width={340} items="center" gap="$1.5" pl={depth * 16}>
          {hasChildren ? (
            <Button
              chromeless
              circular
              size="$1"
              p="$0"
              icon={isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              onPress={() => onToggle(obs.id)}
            />
          ) : (
            <YStack width={20} />
          )}
          <Badge label={obs.type} />
          <Text fontSize="$3" color="$color12" numberOfLines={1}>
            {obs.name || obs.id}
          </Text>
          {obs.model ? (
            <Text fontSize="$2" color="$color10" numberOfLines={1}>
              {obs.model}
            </Text>
          ) : null}
        </XStack>
        <Waterfall obs={obs} win={win} />
        <YStack width={84} items="flex-end">
          <Text fontSize="$2" color="$color11">
            {fmtLatency(elapsed(obs.startTime, obs.endTime))}
          </Text>
        </YStack>
      </XStack>
      {hasChildren && !isCollapsed
        ? children.map((c) => (
            <SpanRow key={c.obs.id} node={c} win={win} collapsed={collapsed} onToggle={onToggle} />
          ))
        : null}
    </>
  )
}

/** The full span tree for a trace's observations; empty state when there are none. */
export function SpanTree({ observations }: { observations: Observation[] }) {
  const forest = useMemo(() => buildForest(observations), [observations])
  const win = useMemo(() => window(observations), [observations])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (observations.length === 0) {
    return (
      <YStack p="$6" items="center" borderWidth={1} borderColor="$borderColor" rounded="$4">
        <Text color="$color11">No observations on this trace.</Text>
      </YStack>
    )
  }

  return (
    <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
      <XStack bg="$color2" py="$2.5" px="$2" gap="$2">
        <Text width={340} fontSize="$2" fontWeight="700" color="$color11">
          Span
        </Text>
        <Text flex={1} fontSize="$2" fontWeight="700" color="$color11">
          Timeline · {fmtLatency(win.span / 1000)}
        </Text>
        <Text width={84} fontSize="$2" fontWeight="700" color="$color11" text="right">
          Duration
        </Text>
      </XStack>
      {forest.map((n) => (
        <SpanRow key={n.obs.id} node={n} win={win} collapsed={collapsed} onToggle={toggle} />
      ))}
    </YStack>
  )
}
