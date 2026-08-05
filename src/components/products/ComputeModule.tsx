'use client'

/**
 * Compute operator boards — the SaaS operator view of compute across EVERY org,
 * grouped org → app → project, split into `kind` lenses over ONE datastore
 * table by `ComputeBoard({ kind })`:
 *
 *   - <BotsModule/>      kind='bot'      — machines running the @hanzo/bot agent (booted, connected).
 *   - <MachinesModule/>  kind='machine'  — raw VMs visor can also open.
 *   - <ClustersModule/>  kind='cluster'  — DOKS clusters visor manages (node pools carry the cost, nest here).
 *   - <FunctionsModule/> kind='function' — serverless functions (honest-empty until the runtime emits).
 *
 * GLOBAL-ADMIN ONLY (both catalog entries are `admin: true`, hidden from every
 * customer surface; the `/v1/admin/compute` aggregate is server-gated by
 * `getAdminGate` before anything is forwarded). This is the compute half of the
 * admin.hanzo.ai control surface, beside Business (MRR) and Finance (margin).
 *
 * SOURCE: the unified datastore (hanzoai/datastore) via cloud-api's
 * `GET /v1/admin/compute?kind=` — ONE cross-tenant GROUP BY, never a per-tenant
 * fan-out (the tenant-data-hierarchy invariant). `AdminComputeApi.compute` folds the
 * raw compute events (or consumes cloud's pre-aggregated leaves) into the tree.
 *
 * HONEST BY CONSTRUCTION: renders an honest empty state until the compute-events
 * emitter + aggregate land — never a fabricated fleet. States: loading,
 * superadmin-required (403), not-routed (404), error, empty.
 */
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Bot, Boxes, Building2, ChevronDown, ChevronRight, Coins, Cpu, FunctionSquare, Layers, Network, RefreshCw } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { AdminComputeApi, type ComputeFleets, type ComputeKind, type Rollup, type SizeCount } from '~/lib/api/admin-compute'
import { MetricCard } from '~/components/ui/Metric'
import { ErrorState, asApiError, isForbidden, SuperAdminRequired, type HonestCopy } from '~/components/ui/States'
import { EmptyState, PageHeader } from '@hanzo/ui/product'

type Range = '24h' | '7d' | '30d'
const RANGES: { key: Range; label: string }[] = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
]

/** Per-kind chrome: the board title/subtitle, unit noun, icon, and honest copy. */
type KindUi = {
  title: string
  subtitle: string
  /** Lower-case singular unit noun for the count column ("bot" / "machine"). */
  unit: string
  Icon: typeof Bot
  emptyTitle: string
  emptyDescription: string
}
const KIND_UI: Record<ComputeKind, KindUi> = {
  bot: {
    title: 'Bots',
    subtitle: 'Every @hanzo/bot agent booted across the platform — grouped org → app → project.',
    unit: 'bots',
    Icon: Bot,
    emptyTitle: 'No bots booted yet',
    emptyDescription:
      'No @hanzo/bot agents have reported to the datastore for this window. As orgs boot bots, their agents and spend appear here grouped by org → app → project.',
  },
  machine: {
    title: 'Machines',
    subtitle: 'Every raw compute machine visor has opened across the platform — grouped org → app → project.',
    unit: 'machines',
    Icon: Boxes,
    emptyTitle: 'No machines opened yet',
    emptyDescription:
      'No machines have reported to the datastore for this window. As orgs provision compute, their machines and spend appear here grouped by org → app → project.',
  },
  cluster: {
    title: 'Clusters',
    subtitle: 'Every DOKS cluster visor manages across the platform — grouped org → app → project.',
    unit: 'clusters',
    Icon: Network,
    emptyTitle: 'No clusters registered yet',
    emptyDescription:
      'No Kubernetes clusters have reported to the datastore for this window. As orgs register DOKS clusters, they and their node pools appear here grouped by org → app → project.',
  },
  nodepool: {
    title: 'Node Pools',
    subtitle: 'Every DOKS node pool visor manages across the platform — grouped org → app → project.',
    unit: 'pools',
    Icon: Layers,
    emptyTitle: 'No node pools yet',
    emptyDescription:
      'No node pools have reported to the datastore for this window. As orgs create DOKS node pools, they and their hourly cost appear here grouped by org → app → project.',
  },
  function: {
    title: 'Functions',
    subtitle: 'Every serverless function invoked across the platform — grouped org → app → project.',
    unit: 'functions',
    Icon: FunctionSquare,
    emptyTitle: 'No function activity yet',
    emptyDescription:
      'No functions have reported to the datastore for this window. Functions appear here once a functions runtime emits compute events, grouped by org → app → project.',
  },
}

const copyFor = (kind: ComputeKind): HonestCopy => ({
  notFound: `The compute-analytics aggregate (GET /v1/admin/compute?kind=${kind} over the datastore) is not routed on this host yet. It appears automatically once cloud-api binds the datastore read and the compute-events emitter is wired.`,
  unauthorized:
    'This is a global-admin operator surface. Access is enforced server-side by the admin gate — sign in with an @hanzo.ai admin account.',
})

const fmtInt = (n: number): string => n.toLocaleString()
const fmtUsd = (cents: number): string =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtWhen = (ts: string): string => {
  if (!ts) return '—'
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString()
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; data: ComputeFleets }

/** The compact count · active · spend figures shown on every tree row. */
function RowStats({ r, ui }: { r: Rollup; ui: KindUi }) {
  return (
    <XStack items="center" gap="$4" flexWrap="wrap" justify="flex-end">
      <Stat icon={<ui.Icon size={13} />} label={ui.unit} value={fmtInt(r.count)} />
      <Stat icon={<Cpu size={13} />} label="active" value={fmtInt(r.active)} />
      <Stat icon={<Coins size={13} />} label="spend" value={fmtUsd(r.spendCents)} strong />
    </XStack>
  )
}

function Stat({ icon, label, value, strong }: { icon: ReactNode; label: string; value: string; strong?: boolean }) {
  return (
    <XStack items="center" gap="$1.5" aria-label={label}>
      <Text color="$color10">{icon}</Text>
      <Text fontSize="$3" fontWeight={strong ? '700' : '500'} color={strong ? '$color12' : '$color11'}>
        {value}
      </Text>
    </XStack>
  )
}

function SizeChips({ sizes }: { sizes: SizeCount[] }) {
  if (!sizes.length) return null
  return (
    <XStack gap="$1.5" flexWrap="wrap">
      {sizes.map((s) => (
        <XStack key={s.size} bg="$color3" px="$2" py="$1" rounded="$3" items="center" gap="$1">
          <Text fontSize="$2" color="$color11">
            {s.size}
          </Text>
          <Text fontSize="$2" fontWeight="700" color="$color12">
            ×{s.count}
          </Text>
        </XStack>
      ))}
    </XStack>
  )
}

/** An expand/collapse header row (org or app level). */
function GroupRow({
  open,
  onToggle,
  icon,
  title,
  stats,
  ui,
  indent,
}: {
  open: boolean
  onToggle: () => void
  icon?: ReactNode
  title: string
  stats: Rollup
  ui: KindUi
  indent?: boolean
}) {
  return (
    <XStack
      onPress={onToggle}
      items="center"
      gap="$2"
      px="$3"
      py="$2.5"
      pl={indent ? '$7' : '$3'}
      bg="transparent"
      borderWidth={0}
      cursor="pointer"
      hoverStyle={{ bg: '$color2' }}
    >
      <Text color="$color10">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</Text>
      {icon ? <Text color="$color11">{icon}</Text> : null}
      <Text fontSize="$4" fontWeight="600" color="$color12" flex={1}>
        {title}
      </Text>
      <RowStats r={stats} ui={ui} />
    </XStack>
  )
}

/** The one board, parameterized by kind — Bots and Machines are the same board. */
function ComputeBoard({ kind }: { kind: ComputeKind }) {
  const ui = KIND_UI[kind]
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [range, setRange] = useState<Range>('30d')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const load = useCallback(
    (r: Range) => {
      let cancelled = false
      setState({ phase: 'loading' })
      AdminComputeApi.compute({ kind, range: r })
        .then((data) => {
          if (!cancelled) setState({ phase: 'ready', data })
        })
        .catch((e) => {
          if (!cancelled) setState({ phase: 'error', err: asApiError(e) })
        })
      return () => {
        cancelled = true
      }
    },
    [kind],
  )

  useEffect(() => load(range), [range, load])

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  return (
    <YStack gap="$4">
      <PageHeader
        title={ui.title}
        subtitle={ui.subtitle}
        actions={
          <XStack items="center" gap="$2">
            <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
              {RANGES.map((r) => (
                <Button
                  key={r.key}
                  size="$2"
                  chromeless
                  bg={range === r.key ? '$color4' : 'transparent'}
                  onPress={() => setRange(r.key)}
                >
                  {r.label}
                </Button>
              ))}
            </XStack>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => load(range)}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state.phase === 'loading' ? (
        <XStack p="$6" justify="center">
          <Text color="$color11">Loading compute analytics…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <SuperAdminRequired />
        ) : (
          <ErrorState err={state.err} onRetry={() => load(range)} copy={copyFor(kind)} />
        )
      ) : state.data.orgs.length === 0 ? (
        <EmptyState
          icon={ui.Icon}
          title={ui.emptyTitle}
          description={ui.emptyDescription}
          bullets={[
            'Source: the unified Hanzo Datastore via GET /v1/admin/compute — one cross-tenant read, never a per-tenant fan-out.',
            'Rows arrive once the compute-events emitter is wired (visor / commerce meter) — no data is fabricated until then.',
          ]}
        />
      ) : (
        <YStack gap="$4">
          <XStack gap="$3" flexWrap="wrap">
            <MetricCard icon={<ui.Icon size={16} />} label={ui.title} value={fmtInt(state.data.totals.count)} caption={`${state.data.orgs.length} orgs`} />
            <MetricCard icon={<Cpu size={16} />} label="Active" value={fmtInt(state.data.totals.active)} caption="running now" />
            <MetricCard icon={<Coins size={16} />} label="Spend" value={fmtUsd(state.data.totals.spendCents)} caption={`last ${range}`} />
          </XStack>

          <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
            {state.data.orgs.map((org) => (
              <YStack key={org.key} borderBottomWidth={1} borderColor="$borderColor">
                <GroupRow open={open.has(org.key)} onToggle={() => toggle(org.key)} icon={<Building2 size={15} />} title={org.org} stats={org} ui={ui} />
                {open.has(org.key)
                  ? org.apps.map((app) => (
                      <YStack key={app.key} bg="$color1">
                        <GroupRow open={open.has(app.key)} onToggle={() => toggle(app.key)} title={app.app} stats={app} ui={ui} indent />
                        {open.has(app.key)
                          ? app.projects.map((p) => (
                              <XStack key={p.key} px="$3" py="$2.5" pl="$10" gap="$3" items="flex-start" bg="$color2" borderTopWidth={1} borderColor="$borderColor" flexWrap="wrap">
                                <YStack flex={1} minW={200} gap="$1.5">
                                  <Text fontSize="$4" fontWeight="600" color="$color12">
                                    {p.project}
                                  </Text>
                                  <SizeChips sizes={p.sizes} />
                                  <Text fontSize="$2" color="$color10">
                                    last activity {fmtWhen(p.lastTs)}
                                  </Text>
                                </YStack>
                                <RowStats r={p} ui={ui} />
                              </XStack>
                            ))
                          : null}
                      </YStack>
                    ))
                  : null}
              </YStack>
            ))}
          </YStack>
        </YStack>
      )}
    </YStack>
  )
}

/** The Bots operator board (kind='bot'). */
export function BotsModule(_props: { params: Record<string, string> }) {
  return <ComputeBoard kind="bot" />
}

/** The Machines operator board (kind='machine'). */
export function MachinesModule(_props: { params: Record<string, string> }) {
  return <ComputeBoard kind="machine" />
}

/** The Clusters operator board (kind='cluster'). Node pools (kind='nodepool') carry the compute cost and nest here as visor's emitter lands. */
export function ClustersModule(_props: { params: Record<string, string> }) {
  return <ComputeBoard kind="cluster" />
}

/** The Functions operator board (kind='function'). Honest-empty until a functions runtime emits compute events. */
export function FunctionsModule(_props: { params: Record<string, string> }) {
  return <ComputeBoard kind="function" />
}
