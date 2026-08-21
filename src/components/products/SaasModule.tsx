'use client'

/**
 * SaaS Metrics — the admin.hanzo.ai business-operations board (global-admin only).
 * The whole-business snapshot: recurring revenue (MRR/ARR, new/churned, by plan
 * category), the subscription mix (per plan, trials, seats, a recent create/cancel
 * feed), metered pay-as-you-go revenue, and the top customers by revenue — all
 * computed IN commerce (the money system of record) and read through
 * `SaasApi.metrics` (the server-gated `/v1/metrics/saas` commerce aggregate;
 * `getAdminGate` fail-closes a non-global-admin BEFORE any cross-tenant row is read).
 *
 * The AI panel is NOT re-derived here: it composes the SAME fleet LLM-observability
 * aggregate the Fleet Observability board uses (`AdminO11yApi`, `/v1/admin/o11y`) —
 * per-model spend, fleet latency and error rate — so there is ONE per-model
 * aggregate, never a fork. The two fetches are independent, so one failing renders
 * an honest partial rather than blanking the board.
 *
 * Gated twice: the registry entry is `admin: true` (hidden from every customer's
 * nav/palette) and this module renders `SuperAdminRequired` for a
 * non-global-admin client. Honest by construction — every figure is a real aggregate
 * or an em-dash; not-instrumented signals (upgrades/downgrades, per-model latency)
 * render honestly, never fabricated.
 */
import { useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { TrendingUp, Coins, Users, Layers, Repeat, Activity, AlertTriangle, Gauge, Cpu, Building2, CreditCard, Boxes } from '@hanzogui/lucide-icons-2'

import { SaasApi, type SaaSMetrics, type SaasWindow } from '~/lib/api/saas'
import { AdminO11yApi, type FleetO11y, type O11yRange } from '~/lib/api/admin-o11y'
import { MetricCard } from '~/components/ui/Metric'
import { asApiError, ErrorState, SuperAdminRequired } from '~/components/ui/States'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { formatMetric } from '~/components/products/overview/living/logic'
import { DataTable, type Column } from '@hanzo/ui/product'

type Range = '7d' | '30d' | '90d'
const RANGES: Range[] = ['7d', '30d', '90d']
/** The o11y aggregate tops out at 30d, so 90d folds to 30d for the AI panel. */
const o11yRangeOf = (r: Range): O11yRange => (r === '90d' ? '30d' : r)

const cents = (v: number): string => formatMetric(v, 'cents')
const count = (v: number): string => formatMetric(v, 'count')
const pct1 = (v: number): string => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—')
const signedCents = (v: number): string => (v > 0 ? `+${cents(v)}` : cents(v))

/** Short label for an ISO timestamp ("2026-07-08T12:00:00Z" → "7/8 12:00"). */
const fmtDate = (iso: string): string => {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
const fmtDay = (iso: string): string => {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`
}

type MState = { loading: boolean; error: unknown; data: SaaSMetrics | null }
type OState = { loading: boolean; error: unknown; data: FleetO11y | null }

const CAT_COLS: Column<SaaSMetrics['revenue']['byCategory'][number]>[] = [
  { key: 'category', header: 'Category', render: (r) => <Text fontSize="$2" numberOfLines={1}>{r.category || '—'}</Text> },
  { key: 'subscriptions', header: 'Subs', width: 72, align: 'right', mono: true, render: (r) => count(r.subscriptions) },
  { key: 'mrrCents', header: 'MRR', width: 96, align: 'right', mono: true, render: (r) => cents(r.mrrCents) },
]

const PLAN_COLS: Column<SaaSMetrics['subscriptions']['byPlan'][number]>[] = [
  { key: 'name', header: 'Plan', render: (r) => <Text fontSize="$2" numberOfLines={1}>{r.name || r.plan || '—'}</Text> },
  { key: 'category', header: 'Category', width: 108, render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.category || '—'}</Text> },
  { key: 'active', header: 'Active', width: 72, align: 'right', mono: true, render: (r) => count(r.active) },
  { key: 'trialing', header: 'Trial', width: 64, align: 'right', mono: true, render: (r) => count(r.trialing) },
  { key: 'seats', header: 'Seats', width: 64, align: 'right', mono: true, render: (r) => count(r.seats) },
  { key: 'mrrCents', header: 'MRR', width: 96, align: 'right', mono: true, render: (r) => cents(r.mrrCents) },
]

const EVENT_COLS: Column<SaaSMetrics['subscriptions']['recent'][number]>[] = [
  { key: 'at', header: 'When', width: 108, mono: true, render: (r) => <Text fontSize="$2" color="$color11">{fmtDate(r.at)}</Text> },
  { key: 'org', header: 'Organization', render: (r) => <Text fontSize="$2" numberOfLines={1}>{r.org || '—'}</Text> },
  { key: 'type', header: 'Event', width: 88, render: (r) => <Text fontSize="$2" color={r.type === 'created' ? '$color12' : '$color10'}>{r.type || '—'}</Text> },
  { key: 'plan', header: 'Plan', width: 120, render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.plan || '—'}</Text> },
  { key: 'mrrDeltaCents', header: 'Δ MRR', width: 96, align: 'right', mono: true, render: (r) => signedCents(r.mrrDeltaCents) },
]

const CUST_COLS: Column<SaaSMetrics['customers'][number]>[] = [
  { key: 'org', header: 'Organization', render: (r) => <Text fontSize="$2" numberOfLines={1}>{r.org || '—'}</Text> },
  { key: 'plan', header: 'Plan', width: 128, render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.plan || '—'}</Text> },
  { key: 'status', header: 'Status', width: 108, render: (r) => <Text fontSize="$2" numberOfLines={1}>{r.status || '—'}</Text> },
  { key: 'mrrCents', header: 'MRR', width: 90, align: 'right', mono: true, render: (r) => cents(r.mrrCents) },
  { key: 'usageCents', header: 'Usage', width: 90, align: 'right', mono: true, render: (r) => cents(r.usageCents) },
  { key: 'seats', header: 'Seats', width: 60, align: 'right', mono: true, render: (r) => count(r.seats) },
  { key: 'since', header: 'Since', width: 84, align: 'right', mono: true, render: (r) => <Text fontSize="$2" color="$color11">{fmtDay(r.since)}</Text> },
]

const MODEL_COLS: Column<FleetO11y['topModels'][number]>[] = [
  { key: 'model', header: 'Model', render: (r) => <Text fontSize="$2" numberOfLines={1}>{r.model || '—'}</Text> },
  { key: 'requests', header: 'Requests', width: 96, align: 'right', mono: true, render: (r) => count(r.requests) },
  { key: 'tokens', header: 'Tokens', width: 96, align: 'right', mono: true, render: (r) => count(r.tokens) },
  { key: 'costCents', header: 'Cost', width: 90, align: 'right', mono: true, render: (r) => cents(r.costCents) },
]

export function SaasModule() {
  const isAdmin = useIsSuperAdmin()
  const [range, setRange] = useState<Range>('30d')
  const [m, setM] = useState<MState>({ loading: true, error: null, data: null })
  const [o, setO] = useState<OState>({ loading: true, error: null, data: null })

  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    setM((s) => ({ ...s, loading: true, error: null }))
    SaasApi.metrics(range as SaasWindow)
      .then((data) => alive && setM({ loading: false, error: null, data }))
      .catch((error) => alive && setM({ loading: false, error, data: null }))
    return () => {
      alive = false
    }
  }, [isAdmin, range])

  // AI panel — the SAME fleet o11y aggregate, fetched independently so its failure
  // never blanks the money board (and vice versa).
  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    setO((s) => ({ ...s, loading: true, error: null }))
    AdminO11yApi.global(o11yRangeOf(range))
      .then((data) => alive && setO({ loading: false, error: null, data }))
      .catch((error) => alive && setO({ loading: false, error, data: null }))
    return () => {
      alive = false
    }
  }, [isAdmin, range])

  if (!isAdmin) return <SuperAdminRequired />

  const d = m.data
  const rev = d?.revenue
  const subs = d?.subscriptions
  const use = d?.usage
  const ai = o.data

  return (
    <YStack gap="$4" p="$4" maxW={1200} self="center" width="100%">
      <XStack items="center" justify="space-between" flexWrap="wrap" gap="$2">
        <YStack gap="$1">
          <XStack items="center" gap="$2">
            <TrendingUp size={20} />
            <Text fontSize="$7" fontWeight="800">
              SaaS Metrics
            </Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            The whole business — MRR/ARR, subscription mix, metered revenue, and top customers, aggregated across every
            tenant from commerce. A customer never sees this.
          </Text>
        </YStack>
        <XStack gap="$1">
          {RANGES.map((r) => (
            <Button key={r} size="$2" chromeless={range !== r} bg={range === r ? '$color5' : 'transparent'} onPress={() => setRange(r)}>
              {r}
            </Button>
          ))}
        </XStack>
      </XStack>

      {m.error ? (
        <ErrorState err={asApiError(m.error)} onRetry={() => setRange((r) => r)} />
      ) : (
        <>
          {/* Revenue KPI band. */}
          <XStack gap="$3" flexWrap="wrap">
            <Kpi icon={<Coins size={15} />} label="MRR" value={rev ? cents(rev.mrrCents) : '—'} caption={rev ? `${cents(rev.arrCents)} ARR` : ''} />
            <Kpi icon={<TrendingUp size={15} />} label="Net-new MRR" value={rev ? signedCents(rev.netNewMrrCents) : '—'} caption={rev ? `+${cents(rev.newMrrCents)} · −${cents(rev.churnedMrrCents)}` : ''} />
            <Kpi icon={<Repeat size={15} />} label="Active subs" value={rev ? count(rev.activeSubscriptions) : '—'} caption={d ? `${count(d.orgs)} orgs` : ''} />
            <Kpi icon={<Users size={15} />} label="Paying customers" value={rev ? count(rev.payingCustomers) : '—'} caption="orgs with a paid plan" />
            <Kpi icon={<Layers size={15} />} label="Trials" value={rev ? count(rev.trials) : '—'} caption="active trials" />
            <Kpi icon={<CreditCard size={15} />} label="Metered revenue" value={use ? cents(use.windowUsageCents) : '—'} caption={use ? (use.instrumented ? `${count(use.requests)} requests` : 'no metered usage yet') : ''} />
          </XStack>

          {/* Revenue by category + subscription mix. */}
          <XStack gap="$4" flexWrap="wrap">
            <Card flex={1} minW={320} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
              <XStack items="center" gap="$2">
                <Coins size={15} />
                <Text fontSize="$4" fontWeight="700">
                  MRR by plan category
                </Text>
              </XStack>
              <DataTable columns={CAT_COLS} rows={rev?.byCategory ?? []} loading={m.loading} rowKey={(r) => r.category} empty="No active subscriptions. MRR splits by plan category here once a tenant is on a paid plan." />
            </Card>
            <Card flex={2} minW={360} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
              <XStack items="center" gap="$2">
                <Layers size={15} />
                <Text fontSize="$4" fontWeight="700">
                  Subscriptions by plan
                </Text>
              </XStack>
              <DataTable columns={PLAN_COLS} rows={subs?.byPlan ?? []} loading={m.loading} rowKey={(r) => r.plan} empty="No subscriptions. Each plan's active, trialing, seat, and MRR counts show here once tenants subscribe." />
            </Card>
          </XStack>

          {/* Recent subscription events. */}
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <XStack items="center" gap="$2">
              <Activity size={15} />
              <Text fontSize="$4" fontWeight="700">
                Recent subscription events
              </Text>
              <Text fontSize="$2" color="$color10">
                (created / canceled this window — upgrades/downgrades are not instrumented)
              </Text>
            </XStack>
            <DataTable columns={EVENT_COLS} rows={subs?.recent ?? []} loading={m.loading} rowKey={(r) => `${r.at}:${r.org}:${r.type}`} empty="No subscription changes this window. Subscriptions created or canceled show here with the MRR they moved — widen the range above to look further back." />
          </Card>

          {/* Top customers. */}
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <XStack items="center" gap="$2" justify="space-between" flexWrap="wrap">
              <XStack items="center" gap="$2">
                <Building2 size={15} />
                <Text fontSize="$4" fontWeight="700">
                  Top customers by revenue
                </Text>
              </XStack>
              <Text fontSize="$2" color="$color10">
                Open the Customers board to drill into an org's subs, usage & invoices.
              </Text>
            </XStack>
            <DataTable columns={CUST_COLS} rows={d?.customers ?? []} loading={m.loading} rowKey={(r) => r.org} empty="No customers with revenue or usage. An org appears here once it carries a plan or metered usage, highest revenue first." />
          </Card>

          {/* AI / LLM observability — the SHARED fleet o11y aggregate. */}
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <XStack items="center" gap="$2" justify="space-between" flexWrap="wrap">
              <XStack items="center" gap="$2">
                <Cpu size={15} />
                <Text fontSize="$4" fontWeight="700">
                  AI usage & LLM observability
                </Text>
              </XStack>
              <Text fontSize="$2" color="$color10">
                Fleet aggregate — full traces & per-service RED in the Fleet Observability board.
              </Text>
            </XStack>
            {o.error ? (
              <Text fontSize="$3" color="$color10">
                Fleet LLM observability is unavailable ({asApiError(o.error).message}). The money panels above are unaffected.
              </Text>
            ) : (
              <>
                <XStack gap="$3" flexWrap="wrap">
                  <Kpi icon={<Coins size={15} />} label="AI cost (fleet)" value={ai ? cents(ai.totals.costCents) : '—'} caption="all orgs, this window" />
                  <Kpi icon={<Activity size={15} />} label="AI requests" value={ai ? count(ai.totals.requests) : '—'} caption={ai ? `${count(ai.totals.tokens)} tokens` : ''} />
                  <Kpi icon={<Gauge size={15} />} label="Latency p95 / p99" value={ai ? `${formatMetric(ai.totals.latencyP95Ms, 'ms')} / ${formatMetric(ai.totals.latencyP99Ms, 'ms')}` : '—'} caption={ai ? `p50 ${formatMetric(ai.totals.latencyP50Ms, 'ms')}` : ''} />
                  <Kpi icon={<AlertTriangle size={15} />} label="Error rate" value={ai ? pct1(ai.totals.traceErrorRate) : '—'} caption={ai ? `${count(ai.totals.errors)} errors` : ''} />
                  <Kpi icon={<Boxes size={15} />} label="Models · orgs" value={ai ? `${count(ai.totals.models)} · ${count(ai.totals.orgs)}` : '—'} caption="serving traffic" />
                </XStack>
                <DataTable columns={MODEL_COLS} rows={ai?.topModels ?? []} loading={o.loading} rowKey={(r) => r.model} empty="No model usage in this window. Models appear here with their requests, tokens, and cost as the fleet serves traffic." />
                <Text fontSize="$2" color="$color10">
                  Per-model latency is not captured anywhere in the stack, and per-model error rate is recorded but not
                  surfaced by the fleet aggregate. The latency and errors above are fleet-wide and per-service — see
                  Fleet Observability.
                </Text>
              </>
            )}
          </Card>

          {/* Honest not-instrumented notes from the backend. */}
          {d && d.gaps.length > 0 ? (
            <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color2">
              <Text fontSize="$3" fontWeight="700" color="$color11">
                Data notes
              </Text>
              {d.gaps.map((note, i) => (
                <Text key={i} fontSize="$2" color="$color10">
                  • {note}
                </Text>
              ))}
            </Card>
          ) : null}
        </>
      )}
    </YStack>
  )
}

/** A flexing KPI tile (wraps to stack on narrow viewports). */
function Kpi({ icon, label, value, caption }: { icon: React.ReactElement; label: string; value: string; caption?: string }) {
  return (
    <YStack flex={1} minW={168}>
      <MetricCard icon={icon} label={label} value={value} caption={caption} />
    </YStack>
  )
}
