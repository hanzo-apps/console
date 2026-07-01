'use client'

/**
 * Overview — the coherence centerpiece of the Hanzo Cloud console.
 *
 * Real-time usage, performance, and spend across AI workloads, wired end-to-end
 * to live data (NO mock data):
 *   • metrics / charts / spend-by-model / recent activity ← `/v1/get-cloud-usages`
 *     (the hanzo.cloud_usage ledger), org-scoped by the X-Org-Id header the client
 *     stamps from currentOrg();
 *   • wallet balance ← commerce `/v1/billing/balance` (WalletApi.cloudBalance);
 *   • quick actions ← the real product registry (no dead links).
 *
 * Honesty over fidelity: every datum without a live source renders "—" and links
 * to the real surface (e.g. infra health → the Status module) rather than being
 * fabricated. The same component, given `allOrgs`, is the all-orgs admin god-view
 * that admin.hanzo.ai reuses against the one endpoint.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  DollarSign,
  Hash,
  Layers,
  MessageSquare,
  Play,
  Plus,
  Rocket,
  Send,
  TrendingDown,
  TrendingUp,
  Upload,
  Wallet,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { ApiError } from '~/lib/api'
import {
  UsageApi,
  type ActivityTab,
  type CloudUsageActivityRow,
  type CloudUsageDelta,
  type CloudUsageOverview,
  type UsageRange,
} from '~/lib/api/usage'
import { WalletApi, type CloudBalance } from '~/lib/api/wallet'
import { catalog, type ProductIcon } from '~/lib/products/registry'
import { openProduct } from '~/lib/products/open'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError } from '~/components/ui/States'
import {
  BarChart,
  CHART_OTHER,
  CHART_PALETTE,
  Donut,
  LineChart,
  Sparkline,
  type ChartPoint,
  type Slice,
} from '~/components/ui/Charts'

// ── format helpers (the repo idiom: local, not a shared util) ────────────────
const usd = (cents: number): string =>
  '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usdCompact = (cents: number): string => {
  const d = cents / 100
  if (Math.abs(d) >= 1000) return '$' + new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(d)
  return usd(cents)
}
const compact = (n: number): string => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
const fmtAxis = (iso: string, interval: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return interval === 'day'
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
const fmtStamp = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const UP = '#23c562'
const DOWN = '#ff5d8f'

type Async<T> = { s: 'loading' } | { s: 'error'; e: ApiError } | { s: 'ready'; v: T }

const RANGES: { key: UsageRange; label: string }[] = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'custom', label: 'Custom' },
]

const ACTIVITY_TABS: { key: ActivityTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'inference', label: 'Inference' },
  { key: 'deployments', label: 'Deployments' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'payments', label: 'Payments' },
]
const ACTIVITY_EMPTY: Record<ActivityTab, string> = {
  all: 'No activity in this range yet.',
  inference: 'No inference calls in this range yet.',
  deployments: "Deployment events aren't in the usage ledger — open Deploy for these.",
  jobs: "Job events aren't in the usage ledger — open Jobs for these.",
  payments: "Payment events aren't in the usage ledger — open Cost & billing for these.",
}

const PAGE = 8

const QUICK_ACTIONS: { id: string; label: string; icon: ProductIcon; hint: string }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, hint: 'Talk to your models' },
  { id: 'playground', label: 'Playground', icon: Play, hint: 'Prompt and compare' },
  { id: 'inference', label: 'Deploy model', icon: Rocket, hint: 'Serve a model endpoint' },
  { id: 'finetuning', label: 'Upload weights', icon: Upload, hint: 'Fine-tune or import' },
  { id: 'agents', label: 'Create agent', icon: Bot, hint: 'Autonomous agents' },
  { id: 'cost', label: 'View usage', icon: BarChart3, hint: 'Cost and billing' },
  { id: 'gpus', label: 'Buy compute', icon: Cpu, hint: 'Provision GPUs' },
]

export default function OverviewDashboard({ allOrgs }: { params?: Record<string, string>; allOrgs?: boolean }) {
  const router = useRouter()
  const [range, setRange] = useState<UsageRange>('24h')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [tab, setTab] = useState<ActivityTab>('all')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [overview, setOverview] = useState<Async<CloudUsageOverview>>({ s: 'loading' })
  const [wallet, setWallet] = useState<Async<CloudBalance>>({ s: 'loading' })
  const reqRef = useRef(0)

  const customReady = range !== 'custom' || customStart !== ''

  useEffect(() => {
    if (!customReady) return
    const id = ++reqRef.current
    setBusy(true)
    UsageApi.overview({
      range,
      start: range === 'custom' ? customStart || undefined : undefined,
      end: range === 'custom' ? customEnd || undefined : undefined,
      activityType: tab,
      activityLimit: PAGE,
      activityOffset: page * PAGE,
      topModels: 6,
      allOrgs,
    })
      .then((v) => {
        if (id === reqRef.current) setOverview({ s: 'ready', v })
      })
      .catch((e) => {
        if (id === reqRef.current) setOverview({ s: 'error', e: asApiError(e) })
      })
      .finally(() => {
        if (id === reqRef.current) setBusy(false)
      })
  }, [range, customStart, customEnd, tab, page, allOrgs, customReady])

  useEffect(() => {
    let alive = true
    WalletApi.cloudBalance('', 'usd')
      .then((v) => alive && setWallet({ s: 'ready', v }))
      .catch((e) => alive && setWallet({ s: 'error', e: asApiError(e) }))
    return () => {
      alive = false
    }
  }, [])

  const onRange = (k: UsageRange) => {
    setRange(k)
    setPage(0)
  }
  const onTab = (k: ActivityTab) => {
    setTab(k)
    setPage(0)
  }

  return (
    <YStack gap="$4">
      <PageHeader
        title={allOrgs ? 'Overview — all orgs' : 'Overview'}
        subtitle="Real-time usage, performance, and spend across your AI workloads."
        actions={
          <XStack gap="$2" items="center">
            {busy ? <Spinner size="small" color="$color10" /> : null}
            <RangeSelector value={range} onChange={onRange} />
          </XStack>
        }
      />

      {range === 'custom' ? (
        <CustomRange start={customStart} end={customEnd} onStart={setCustomStart} onEnd={setCustomEnd} />
      ) : null}

      {overview.s === 'error' ? (
        <ErrorState
          err={overview.e}
          onRetry={() => onRange(range)}
          copy={{
            notFound: 'The usage ledger is not reachable on this deployment yet. It lights up once the cloud-api datastore peer is connected.',
          }}
        />
      ) : overview.s === 'loading' ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$6" items="center">
          <Spinner size="large" color="$color11" />
        </Card>
      ) : (
        <Body
          ov={overview.v}
          wallet={wallet}
          tab={tab}
          onTab={onTab}
          page={page}
          setPage={setPage}
          push={(p) => router.push(p)}
        />
      )}
    </YStack>
  )
}

// ── Body ─────────────────────────────────────────────────────────────────────

function Body({
  ov,
  wallet,
  tab,
  onTab,
  page,
  setPage,
  push,
}: {
  ov: CloudUsageOverview
  wallet: Async<CloudBalance>
  tab: ActivityTab
  onTab: (t: ActivityTab) => void
  page: number
  setPage: (n: number) => void
  push: (path: string) => void
}) {
  const { totals, deltas, series, byModel, activity, interval } = ov
  const tokensLine: ChartPoint[] = series.map((p) => ({ label: fmtAxis(p.t, interval), value: p.tokens }))
  const spendBars: ChartPoint[] = series.map((p) => ({ label: fmtAxis(p.t, interval), value: p.spendCents }))

  return (
    <>
      {/* Metric cards */}
      <XStack flexWrap="wrap" gap="$3">
        <MetricCard
          icon={Hash}
          label="Total Inference Tokens"
          value={compact(totals.tokens)}
          delta={deltas.tokens}
          spark={series.map((p) => p.tokens)}
          color={CHART_PALETTE[0]}
        />
        <MetricCard
          icon={DollarSign}
          label="Total Spend (USD)"
          value={usdCompact(totals.spendCents)}
          delta={deltas.spendCents}
          spark={series.map((p) => p.spendCents)}
          color={CHART_PALETTE[1]}
        />
        <MetricCard
          icon={Activity}
          label="Requests"
          value={compact(totals.requests)}
          delta={deltas.requests}
          spark={series.map((p) => p.requests)}
          color={CHART_PALETTE[3]}
        />
        <MetricCard
          icon={Layers}
          label="Active Models"
          value={String(totals.models)}
          sub={`across ${totals.providers} provider${totals.providers === 1 ? '' : 's'}`}
          delta={deltas.models}
          spark={series.map((p) => p.models)}
          color={CHART_PALETTE[6]}
        />
      </XStack>

      {/* Time-series charts */}
      <XStack flexWrap="wrap" gap="$3">
        <ChartCard title="Inference tokens over time" subtitle={`${compact(totals.tokens)} tokens`} flex={1}>
          <LineChart data={tokensLine} color={CHART_PALETTE[0]} formatValue={(v) => `${compact(v)} tokens`} />
        </ChartCard>
        <ChartCard title="Spend over time (USD)" subtitle={usd(totals.spendCents)} flex={1}>
          <BarChart data={spendBars} color={CHART_PALETTE[1]} formatValue={(v) => usd(v)} />
        </ChartCard>
      </XStack>

      {/* Spend by model + Wallet */}
      <XStack flexWrap="wrap" gap="$3">
        <SpendByModel byModel={byModel} flex={1.4} />
        <WalletCard wallet={wallet} flex={1} />
      </XStack>

      {/* Recent activity */}
      <RecentActivity activity={activity} tab={tab} onTab={onTab} page={page} setPage={setPage} push={push} />

      {/* Quick actions */}
      <YStack gap="$3">
        <Text fontSize="$5" fontWeight="800" color="$color12">
          Quick actions
        </Text>
        <XStack flexWrap="wrap" gap="$3">
          {QUICK_ACTIONS.map((a) => (
            <QuickAction key={a.id} action={a} push={push} />
          ))}
        </XStack>
      </YStack>

      {/* System status */}
      <SystemStatus push={push} />
    </>
  )
}

// ── Time range ────────────────────────────────────────────────────────────────

function RangeSelector({ value, onChange }: { value: UsageRange; onChange: (k: UsageRange) => void }) {
  return (
    <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
      {RANGES.map((r) => {
        const active = r.key === value
        return (
          <Button
            key={r.key}
            size="$2"
            chromeless={!active}
            bg={active ? '$color5' : 'transparent'}
            rounded="$0"
            onPress={() => onChange(r.key)}
          >
            <Text fontSize="$2" fontWeight={active ? '700' : '500'} color={active ? '$color12' : '$color10'}>
              {r.label}
            </Text>
          </Button>
        )
      })}
    </XStack>
  )
}

function CustomRange({
  start,
  end,
  onStart,
  onEnd,
}: {
  start: string
  end: string
  onStart: (v: string) => void
  onEnd: (v: string) => void
}) {
  const toIso = (d: string, endOfDay: boolean) => (d ? `${d}T${endOfDay ? '23:59:59' : '00:00:00'}Z` : '')
  const fromIso = (iso: string) => (iso ? iso.slice(0, 10) : '')
  const inputStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid rgba(148,163,184,0.25)',
    borderRadius: 6,
    color: 'inherit',
    padding: '4px 8px',
    fontSize: 13,
    colorScheme: 'dark',
  }
  return (
    <XStack gap="$2" items="center">
      <Text fontSize="$2" color="$color10">
        From
      </Text>
      <input type="date" value={fromIso(start)} max={fromIso(end) || undefined} onChange={(e) => onStart(toIso(e.target.value, false))} style={inputStyle} />
      <Text fontSize="$2" color="$color10">
        to
      </Text>
      <input type="date" value={fromIso(end)} min={fromIso(start) || undefined} onChange={(e) => onEnd(toIso(e.target.value, true))} style={inputStyle} />
    </XStack>
  )
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  delta,
  spark,
  color,
}: {
  icon: ProductIcon
  label: string
  value: string
  sub?: string
  delta?: CloudUsageDelta
  spark: number[]
  color: string
}) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" flex={1} minW={232}>
      <XStack items="center" gap="$2">
        <Icon size={15} opacity={0.7} />
        <Text fontSize="$2" color="$color10">
          {label}
        </Text>
      </XStack>
      <Text fontSize="$9" fontWeight="900" color="$color12">
        {value}
      </Text>
      <XStack justify="space-between" items="flex-end" gap="$2">
        <YStack gap="$1">
          {sub ? (
            <Text fontSize="$1" color="$color10">
              {sub}
            </Text>
          ) : null}
          <DeltaPill delta={delta} />
        </YStack>
        <Sparkline values={spark} color={color} />
      </XStack>
    </Card>
  )
}

function DeltaPill({ delta }: { delta?: CloudUsageDelta }) {
  if (!delta || delta.pct === null) {
    return (
      <Text fontSize="$1" color="$color10">
        — vs yesterday
      </Text>
    )
  }
  const up = delta.pct >= 0
  const Icon = up ? TrendingUp : TrendingDown
  const color = up ? UP : DOWN
  return (
    <XStack items="center" gap="$1">
      <Icon size={12} color={color} />
      <Text fontSize="$1" fontWeight="700" style={{ color }}>
        {`${up ? '+' : ''}${delta.pct}%`}
      </Text>
      <Text fontSize="$1" color="$color10">
        vs prior
      </Text>
    </XStack>
  )
}

// ── Chart card shell ──────────────────────────────────────────────────────────

function ChartCard({ title, subtitle, flex, children }: { title: string; subtitle?: string; flex?: number; children: React.ReactNode }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" flex={flex} minW={320}>
      <XStack justify="space-between" items="center">
        <Text fontSize="$4" fontWeight="700" color="$color12">
          {title}
        </Text>
        {subtitle ? (
          <Text fontSize="$2" color="$color10">
            {subtitle}
          </Text>
        ) : null}
      </XStack>
      {children}
    </Card>
  )
}

// ── Spend by model ────────────────────────────────────────────────────────────

function SpendByModel({ byModel, flex }: { byModel: CloudUsageOverview['byModel']; flex?: number }) {
  const slices: Slice[] = byModel.items.map((m, i) => ({
    label: m.model,
    value: m.spendCents,
    color: CHART_PALETTE[i % CHART_PALETTE.length],
  }))
  if (byModel.other) slices.push({ label: 'Other', value: byModel.other.spendCents, color: CHART_OTHER })
  const hasSpend = byModel.totalCents > 0

  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" flex={flex} minW={340}>
      <Text fontSize="$4" fontWeight="700" color="$color12">
        Spend by model
      </Text>
      {!hasSpend ? (
        <YStack p="$6" items="center" gap="$2">
          <Text color="$color11">No spend recorded in this range.</Text>
          <Text fontSize="$1" color="$color10">
            Spend appears here as soon as billed inference runs.
          </Text>
        </YStack>
      ) : (
        <XStack flexWrap="wrap" gap="$4" items="center">
          <Donut
            slices={slices}
            center={
              <>
                <Text fontSize="$5" fontWeight="900" color="$color12">
                  {usdCompact(byModel.totalCents)}
                </Text>
                <Text fontSize="$1" color="$color10">
                  total spend
                </Text>
              </>
            }
          />
          <YStack flex={1} minW={220} gap="$2">
            {byModel.items.map((m, i) => (
              <ModelRow
                key={m.model}
                swatch={CHART_PALETTE[i % CHART_PALETTE.length]}
                title={m.model}
                subtitle={m.provider}
                amount={usd(m.spendCents)}
                pct={m.pct}
              />
            ))}
            {byModel.other ? (
              <ModelRow
                swatch={CHART_OTHER}
                title={`Other (${byModel.other.modelCount})`}
                subtitle="remaining models"
                amount={usd(byModel.other.spendCents)}
                pct={byModel.other.pct}
              />
            ) : null}
          </YStack>
        </XStack>
      )}
    </Card>
  )
}

function ModelRow({ swatch, title, subtitle, amount, pct }: { swatch: string; title: string; subtitle: string; amount: string; pct: number }) {
  return (
    <XStack items="center" gap="$2.5">
      <YStack width={10} height={10} rounded="$10" style={{ backgroundColor: swatch }} />
      <YStack flex={1}>
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {title}
        </Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {subtitle}
        </Text>
      </YStack>
      <YStack items="flex-end">
        <Text fontSize="$3" fontWeight="700" color="$color12">
          {amount}
        </Text>
        <Text fontSize="$1" color="$color10">
          {pct}%
        </Text>
      </YStack>
    </XStack>
  )
}

// ── Recent activity ───────────────────────────────────────────────────────────

function RecentActivity({
  activity,
  tab,
  onTab,
  page,
  setPage,
  push,
}: {
  activity: CloudUsageOverview['activity']
  tab: ActivityTab
  onTab: (t: ActivityTab) => void
  page: number
  setPage: (n: number) => void
  push: (path: string) => void
}) {
  const total = activity.total
  const lastPage = Math.max(0, Math.ceil(total / PAGE) - 1)
  const from = total === 0 ? 0 : page * PAGE + 1
  const to = Math.min(total, page * PAGE + activity.items.length)

  const columns: Column<CloudUsageActivityRow>[] = [
    {
      key: 'event',
      header: 'Event',
      render: (r) => (
        <XStack items="center" gap="$2">
          <YStack width={7} height={7} rounded="$10" style={{ backgroundColor: r.status === 'success' || r.status === '' ? UP : DOWN }} />
          <Text fontSize="$3" color="$color12">
            Inference
          </Text>
        </XStack>
      ),
    },
    {
      key: 'model',
      header: 'Model / provider',
      render: (r) => (
        <YStack>
          <Text fontSize="$3" color="$color12" numberOfLines={1}>
            {r.model || '—'}
          </Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {r.provider || '—'}
          </Text>
        </YStack>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 116,
      render: (r) => (
        <XStack gap="$1" flexWrap="wrap">
          <Tag text={r.stream ? 'stream' : 'sync'} />
          {r.premium ? <Tag text="premium" tone="accent" /> : null}
        </XStack>
      ),
    },
    {
      key: 'tokens',
      header: 'Tokens',
      width: 116,
      render: (r) => (
        <YStack>
          <Text fontSize="$3" color="$color12">
            {compact(r.tokens)}
          </Text>
          <Text fontSize="$1" color="$color10">
            {compact(r.promptTokens)} / {compact(r.completionTokens)}
          </Text>
        </YStack>
      ),
    },
    { key: 'cost', header: 'Cost', width: 92, render: (r) => <Text fontSize="$3" color="$color12">{usd(r.costCents)}</Text> },
    {
      key: 'time',
      header: 'Time',
      width: 150,
      render: (r) => (
        <XStack items="center" gap="$1.5">
          <Clock size={12} opacity={0.6} />
          <Text fontSize="$2" color="$color11">
            {fmtStamp(r.time)}
          </Text>
        </XStack>
      ),
    },
  ]

  return (
    <YStack gap="$3">
      <XStack justify="space-between" items="center" flexWrap="wrap" gap="$2">
        <Text fontSize="$5" fontWeight="800" color="$color12">
          Recent activity
        </Text>
        <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
          {ACTIVITY_TABS.map((t) => {
            const active = t.key === tab
            return (
              <Button key={t.key} size="$2" chromeless={!active} bg={active ? '$color5' : 'transparent'} rounded="$0" onPress={() => onTab(t.key)}>
                <Text fontSize="$2" fontWeight={active ? '700' : '500'} color={active ? '$color12' : '$color10'}>
                  {t.label}
                </Text>
              </Button>
            )
          })}
        </XStack>
      </XStack>

      <DataTable
        columns={columns}
        rows={activity.items}
        rowKey={(r) => r.requestId || `${r.time}-${r.model}-${r.user}`}
        empty={ACTIVITY_EMPTY[tab]}
      />

      {total > PAGE ? (
        <XStack justify="space-between" items="center">
          <Text fontSize="$2" color="$color10">
            {from}–{to} of {total.toLocaleString()}
          </Text>
          <XStack gap="$2">
            <Button size="$2" disabled={page <= 0} opacity={page <= 0 ? 0.4 : 1} icon={<ChevronLeft size={15} />} onPress={() => setPage(Math.max(0, page - 1))}>
              Prev
            </Button>
            <Button size="$2" disabled={page >= lastPage} opacity={page >= lastPage ? 0.4 : 1} iconAfter={<ChevronRight size={15} />} onPress={() => setPage(Math.min(lastPage, page + 1))}>
              Next
            </Button>
          </XStack>
        </XStack>
      ) : null}

      {(tab === 'deployments' || tab === 'jobs' || tab === 'payments') && activity.items.length === 0 ? (
        <Button
          size="$2"
          self="flex-start"
          chromeless
          iconAfter={<ArrowRight size={14} />}
          onPress={() => push(tab === 'payments' ? '/cost' : tab === 'jobs' ? '/jobs' : '/applications')}
        >
          {tab === 'payments' ? 'Open Cost & billing' : tab === 'jobs' ? 'Open Jobs' : 'Open Deploy'}
        </Button>
      ) : null}
    </YStack>
  )
}

function Tag({ text, tone }: { text: string; tone?: 'accent' }) {
  return (
    <XStack bg={tone === 'accent' ? '$color5' : '$color3'} px="$2" py="$0.5" rounded="$10">
      <Text fontSize="$1" color="$color11" fontWeight="600">
        {text}
      </Text>
    </XStack>
  )
}

// ── Quick actions ─────────────────────────────────────────────────────────────

function QuickAction({ action, push }: { action: { id: string; label: string; icon: ProductIcon; hint: string }; push: (p: string) => void }) {
  const entry = catalog.find((e) => e.id === action.id)
  const Icon = action.icon
  return (
    <Card
      borderWidth={1}
      borderColor="$borderColor"
      p="$3.5"
      gap="$2"
      width={210}
      cursor="pointer"
      hoverStyle={{ bg: '$color2', borderColor: '$color7' }}
      onPress={() => entry && openProduct(entry, push)}
    >
      <XStack justify="space-between" items="center">
        <Icon size={20} />
        <ArrowRight size={14} opacity={0.5} />
      </XStack>
      <Text fontSize="$4" fontWeight="700" color="$color12">
        {action.label}
      </Text>
      <Text fontSize="$1" color="$color10" numberOfLines={1}>
        {action.hint}
      </Text>
    </Card>
  )
}

// ── System status (honest) ────────────────────────────────────────────────────

function SystemStatus({ push }: { push: (p: string) => void }) {
  const cells: { label: string; value: string }[] = [
    { label: 'GPU capacity', value: '—' },
    { label: 'Active jobs', value: '—' },
    { label: 'Queue', value: '—' },
    { label: 'Avg latency', value: '—' },
  ]
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
      <XStack justify="space-between" items="center" flexWrap="wrap" gap="$3">
        <XStack items="center" gap="$2">
          <YStack width={9} height={9} rounded="$10" style={{ backgroundColor: UP }} />
          <Text fontSize="$3" fontWeight="700" color="$color12">
            System status
          </Text>
          <Text fontSize="$2" color="$color10">
            Live infrastructure health is reported on the status page.
          </Text>
        </XStack>
        <Button size="$2" chromeless iconAfter={<ArrowRight size={14} />} onPress={() => push('/status')}>
          View status
        </Button>
      </XStack>
      <XStack flexWrap="wrap" gap="$3">
        {cells.map((c) => (
          <YStack key={c.label} flex={1} minW={150} gap="$1">
            <Text fontSize="$6" fontWeight="800" color="$color11">
              {c.value}
            </Text>
            <Text fontSize="$1" color="$color10">
              {c.label}
            </Text>
          </YStack>
        ))}
      </XStack>
    </Card>
  )
}

// ── Wallet ────────────────────────────────────────────────────────────────────

function WalletCard({ wallet, flex }: { wallet: Async<CloudBalance>; flex?: number }) {
  const topup = `${config.billingUrl}/topup`
  const portal = config.billingUrl
  const openExt = (url: string) => {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
  }
  const available = wallet.s === 'ready' ? usd(wallet.v.available) : wallet.s === 'loading' ? '' : '—'
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" flex={flex} minW={260}>
      <XStack items="center" gap="$2">
        <Wallet size={16} />
        <Text fontSize="$4" fontWeight="700" color="$color12">
          Wallet
        </Text>
      </XStack>

      {wallet.s === 'loading' ? (
        <XStack p="$4" justify="center">
          <Spinner size="small" color="$color10" />
        </XStack>
      ) : (
        <YStack gap="$1">
          <Text fontSize="$2" color="$color10">
            Available balance
          </Text>
          <Text fontSize="$9" fontWeight="900" color="$color12">
            {available}
          </Text>
          {wallet.s === 'ready' ? (
            <Text fontSize="$1" color="$color10">
              {usd(wallet.v.balance)} total · {usd(wallet.v.holds)} on hold
            </Text>
          ) : (
            <Text fontSize="$1" color="$color10">
              Balance isn&apos;t available on this deployment yet.
            </Text>
          )}
        </YStack>
      )}

      <XStack gap="$2" flexWrap="wrap">
        <Button size="$2" bg="$color5" icon={<Plus size={14} />} onPress={() => openExt(topup)}>
          Add funds
        </Button>
        <Button size="$2" chromeless borderWidth={1} borderColor="$borderColor" icon={<Send size={14} />} onPress={() => openExt(portal)}>
          Send
        </Button>
        <Button size="$2" chromeless borderWidth={1} borderColor="$borderColor" icon={<ArrowLeftRight size={14} />} onPress={() => openExt(portal)}>
          Swap
        </Button>
      </XStack>
    </Card>
  )
}
