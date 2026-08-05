'use client'

/**
 * admin.hanzo.ai AI ECONOMICS board — the model-mix + unit-economics + training/eval
 * flywheel lens. GLOBAL-ADMIN ONLY (`admin: true`; every `/v1/admin/*` read is
 * server-gated by `getAdminGate`). The STRATEGIC sibling of Provider Billing (the
 * treasury credit/funding lens) and Finance (the SaaS P&L board): this one answers
 * "how many requests hit each model, at what margin, and how the eval/training loop
 * feeds the next router". It COMPOSES the existing admin reads — it never forks them:
 *   (a) Model mix     — the KEY: requests / share / tokens / cost per (provider, model),
 *                       folded from `/v1/admin/usage/funding` over a selectable window.
 *   (b) Profitability — upstream cost vs revenue vs gross margin + runway (`/v1/admin/
 *                       finance`) and the per-provider credit position (`/v1/admin/
 *                       providers/credit`).
 *   (c) Training data — the HONEST collection card: the metering ledger holds NO
 *                       prompt/completion content and nothing harvests traffic, so the
 *                       only training data is the user-curated eval dataset registry
 *                       (+ direct `/v1/training` uploads). Live dataset/item counts.
 *   (d) Evals         — recent dataset runs with their judge model + average score.
 *   (e) Router loop   — how eval scores fold into the enso router (offline ridge +
 *                       online LinUCB), with the honest "no per-request reward yet".
 *
 * Renders gracefully for empty sets and never fabricates a number — every value is a
 * real backend read that degrades to 0 / '—' / an honest empty note.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  ArrowUpRight,
  Boxes,
  Brain,
  Coins,
  Cpu,
  Database,
  ExternalLink,
  Flame,
  FlaskConical,
  Gauge,
  RefreshCw,
  Route,
  Scale,
  ScrollText,
  Server,
  TrendingUp,
  Wallet,
} from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import {
  AiEconomicsApi,
  topModelShares,
  marginTone,
  marginPctLabel,
  datasetStats,
  recentRuns,
  fmtScore,
  type ModelMix,
  type ModelMixRow,
} from '~/lib/api/ai-economics'
import {
  ProviderBillingApi,
  usd,
  compactNumber,
  runwayLabel,
  runwayTone,
  type ProviderCredit,
} from '~/lib/api/provider-billing'
import { FinanceApi, type Finance } from '~/lib/api/finance'
import { EvalsApi, type EvalDataset, type EvalDatasetRun, type EvalEvaluator } from '~/lib/api/evals'
import type { RangeKey } from '~/lib/api/aimetrics'
import { MetricCard } from '~/components/ui/Metric'
import { Donut } from '~/components/ui/Charts'
import { RAMP, OTHER } from '~/lib/theme/ramp'
import { RangeTabs } from '~/components/products/billing/RangeTabs'
import { ErrorState, asApiError, isForbidden, SuperAdminRequired } from '~/components/ui/States'
import { toneColor, toneVar } from '~/components/ui/tone'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

// ── small presentational helpers ──────────────────────────────────────────────

const TONE: Record<'ok' | 'warn' | 'crit' | 'muted', { bg: string; fg: string }> = {
  ok: { bg: 'var(--color4)', fg: toneVar('positive') },
  warn: { bg: 'var(--color4)', fg: toneVar('warning') },
  crit: { bg: 'var(--color5)', fg: toneVar('critical') },
  muted: { bg: 'var(--color3)', fg: toneVar('muted') },
}

/** Runway urgency color — undefined = the calm default token; hex for warn/crit. */
const RUNWAY_COLOR: Record<'ok' | 'warn' | 'crit', string | undefined> = { ok: undefined, warn: toneVar('warning'), crit: toneVar('critical') }

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'crit' | 'muted'; children: string }) {
  const c = TONE[tone]
  // Arbitrary rgba/hex go through `style` (Tamagui bg/color take theme tokens + hex
  // literals only, per the Charts.tsx / provider-billing convention).
  return (
    <XStack style={{ backgroundColor: c.bg }} px="$2.5" py="$1" rounded="$10" items="center">
      <Text fontSize="$1" fontWeight="700" style={{ color: c.fg }}>
        {children}
      </Text>
    </XStack>
  )
}

/** A section heading + optional sub-line. */
function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <XStack items="center" justify="space-between" flexWrap="wrap" gap="$2">
      <YStack gap="$0.5">
        <Text fontSize="$5" fontWeight="600" color="$color12">
          {title}
        </Text>
        {sub ? (
          <Text fontSize="$2" color="$color10">
            {sub}
          </Text>
        ) : null}
      </YStack>
      {right}
    </XStack>
  )
}

/** An honest inline note card (empty state / explanatory copy). */
function NoteCard({ title, children, testid }: { title: string; children: React.ReactNode; testid?: string }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" testID={testid}>
      <Text fontSize="$4" fontWeight="600" color="$color12">
        {title}
      </Text>
      {children}
    </Card>
  )
}

/** One thin share bar (0..1) — the in-row share visual for the model-mix table. */
function ShareBar({ share }: { share: number }) {
  return (
    <YStack width={54} height={8} bg="$color3" rounded="$2" overflow="hidden">
      <YStack height={8} width={`${Math.max(2, Math.min(100, share * 100))}%`} bg="$color9" rounded="$2" />
    </YStack>
  )
}

/** A titled key/value stat used inside the router-loop step list. */
function StepFact({ label, value }: { label: string; value: string }) {
  return (
    <YStack gap="$0.5" minW={92}>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text className="hz-mono" fontSize="$5" fontWeight="600" color="$color12">
        {value}
      </Text>
    </YStack>
  )
}

/** Short date for a run timestamp; '—' when absent/unparseable. */
function shortWhen(iso?: string): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** A model-mix table row, plus the synthetic totals row appended at the bottom. */
type MixDisplayRow = ModelMixRow & { _total?: boolean }

// ── module ────────────────────────────────────────────────────────────────────

export function AiEconomicsModule() {
  const [range, setRange] = useState<RangeKey>('7d')
  const [loading, setLoading] = useState(true)

  const [mix, setMix] = useState<ModelMix | null>(null)
  const [mixErr, setMixErr] = useState<ApiError | null>(null)
  const [finance, setFinance] = useState<Finance | null>(null)
  const [financeErr, setFinanceErr] = useState<ApiError | null>(null)
  const [credit, setCredit] = useState<ProviderCredit[] | null>(null)
  const [creditErr, setCreditErr] = useState<ApiError | null>(null)

  const [datasets, setDatasets] = useState<EvalDataset[] | null>(null)
  const [datasetsErr, setDatasetsErr] = useState<ApiError | null>(null)
  const [runs, setRuns] = useState<EvalDatasetRun[] | null>(null)
  const [runsErr, setRunsErr] = useState<ApiError | null>(null)
  const [evaluators, setEvaluators] = useState<EvalEvaluator[] | null>(null)

  const loadMix = useCallback(async (r: RangeKey) => {
    setMixErr(null)
    try {
      setMix(await AiEconomicsApi.modelMix(r))
    } catch (e) {
      setMixErr(asApiError(e))
    }
  }, [])

  const loadFinance = useCallback(async () => {
    setFinanceErr(null)
    try {
      setFinance(await FinanceApi.finance())
    } catch (e) {
      setFinanceErr(asApiError(e))
    }
  }, [])

  const loadCredit = useCallback(async () => {
    setCreditErr(null)
    try {
      setCredit(await ProviderBillingApi.credit())
    } catch (e) {
      setCreditErr(asApiError(e))
    }
  }, [])

  const loadEvals = useCallback(async () => {
    setDatasetsErr(null)
    setRunsErr(null)
    // Evals reads are org-scoped `/v1/evals/*` (a DISTINCT gate from the admin
    // aggregate) — settle each independently so one empty/unrouted read never blanks
    // the others.
    const [d, r, e] = await Promise.allSettled([EvalsApi.listDatasets(), EvalsApi.listRuns(), EvalsApi.listEvaluators()])
    if (d.status === 'fulfilled') setDatasets(d.value)
    else setDatasetsErr(asApiError(d.reason))
    if (r.status === 'fulfilled') setRuns(r.value)
    else setRunsErr(asApiError(r.reason))
    if (e.status === 'fulfilled') setEvaluators(e.value)
    else setEvaluators([])
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.allSettled([loadMix(range), loadFinance(), loadCredit(), loadEvals()])
    setLoading(false)
  }, [loadMix, loadFinance, loadCredit, loadEvals, range])

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onRange = useCallback(
    (r: RangeKey) => {
      setRange(r)
      void loadMix(r)
    },
    [loadMix],
  )

  const ds = useMemo(() => datasetStats(datasets ?? []), [datasets])
  const runsRecent = useMemo(() => recentRuns(runs ?? [], 10), [runs])
  const derived = finance?.derived
  const revenue = finance?.revenue
  const cost = finance?.cost

  // Model-mix rows + the appended totals row.
  const mixRows: MixDisplayRow[] = useMemo(() => {
    if (!mix) return []
    const rows: MixDisplayRow[] = mix.rows.map((r) => ({ ...r }))
    if (mix.rows.length > 0) {
      rows.push({
        provider: '',
        model: 'All models',
        requests: mix.total.requests,
        tokens: mix.total.tokens,
        costCents: mix.total.costCents,
        requestShare: 1,
        _total: true,
      })
    }
    return rows
  }, [mix])

  const mixSlices = useMemo(() => {
    if (!mix) return []
    return topModelShares(mix, 6).map((s, i) => ({
      label: s.label,
      value: s.value,
      color: s.label === 'Other' ? OTHER : RAMP[i % RAMP.length],
    }))
  }, [mix])

  const mixCols: Column<MixDisplayRow>[] = [
    {
      key: 'provider',
      header: 'Provider',
      render: (r) => (
        <Text fontSize="$2" color="$color11" numberOfLines={1}>
          {r._total ? '' : r.provider || '—'}
        </Text>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      render: (r) => (
        <Text fontSize="$3" color="$color12" fontWeight={r._total ? '700' : '400'} numberOfLines={1}>
          {r.model || '—'}
        </Text>
      ),
    },
    {
      key: 'requests',
      header: 'Requests',
      align: 'right',
      mono: true,
      render: (r) => (
        <Text className="hz-mono" fontSize="$2" fontWeight={r._total ? '700' : '400'} color="$color12">
          {compactNumber(r.requests)}
        </Text>
      ),
    },
    {
      key: 'share',
      header: 'Share',
      align: 'right',
      render: (r) => (
        <XStack items="center" gap="$2" justify="flex-end">
          <ShareBar share={r.requestShare} />
          <Text className="hz-mono" fontSize="$2" fontWeight={r._total ? '700' : '400'} color="$color12" width={46} text="right">
            {(r.requestShare * 100).toFixed(r.requestShare < 0.1 && !r._total ? 1 : 0)}%
          </Text>
        </XStack>
      ),
      width: 128,
    },
    {
      key: 'tokens',
      header: 'Tokens',
      align: 'right',
      mono: true,
      render: (r) => (
        <Text className="hz-mono" fontSize="$2" color="$color11">
          {compactNumber(r.tokens)}
        </Text>
      ),
    },
    {
      key: 'costCents',
      header: 'Cost',
      align: 'right',
      mono: true,
      render: (r) => (
        <Text className="hz-mono" fontSize="$2" fontWeight={r._total ? '700' : '400'} color="$color12">
          {usd(r.costCents)}
        </Text>
      ),
    },
  ]

  const creditRows = useMemo(
    () => [...(credit ?? [])].sort((a, b) => b.remainingCents - a.remainingCents),
    [credit],
  )
  const creditCols: Column<ProviderCredit>[] = [
    { key: 'provider', header: 'Provider', render: (c) => <Text fontSize="$3" color="$color12">{c.provider || '—'}</Text> },
    { key: 'remainingCents', header: 'Remaining', align: 'right', mono: true, render: (c) => <Text className="hz-mono" fontSize="$2" color={c.hasCredit ? toneColor('positive') : '$color11'}>{usd(c.remainingCents)}</Text> },
    { key: 'burnCents', header: 'Burn / day', align: 'right', mono: true, render: (c) => <Text className="hz-mono" fontSize="$2" color="$color11">{usd(c.burnCents)}</Text> },
    { key: 'runwayDays', header: 'Runway', align: 'right', render: (c) => <Text className="hz-mono" fontSize="$2" style={RUNWAY_COLOR[runwayTone(c.runwayDays)] ? { color: RUNWAY_COLOR[runwayTone(c.runwayDays)] } : undefined} color="$color11">{runwayLabel(c.runwayDays)}</Text> },
  ]

  const runCols: Column<EvalDatasetRun>[] = [
    { key: 'runName', header: 'Run', render: (r) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{r.runName || '—'}</Text> },
    { key: 'dataset', header: 'Dataset', render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.dataset || '—'}</Text> },
    { key: 'judgeModel', header: 'Evaluator', render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.judgeModel || r.model || '—'}</Text> },
    {
      key: 'avgScore',
      header: 'Score',
      align: 'right',
      mono: true,
      render: (r) => (
        <XStack items="center" gap="$2" justify="flex-end">
          <Text className="hz-mono" fontSize="$2" color="$color12" fontWeight="600">{fmtScore(r.avgScore)}</Text>
          <Text fontSize="$1" color="$color10">{`${compactNumber(r.scored ?? 0)}/${compactNumber(r.items ?? 0)}`}</Text>
        </XStack>
      ),
      width: 132,
    },
    { key: 'createdAt', header: 'When', align: 'right', mono: true, render: (r) => <Text className="hz-mono" fontSize="$2" color="$color10">{shortWhen(r.createdAt)}</Text>, width: 84 },
  ]

  const marginPct = derived?.grossMarginPct ?? 0
  const noMix = mix !== null && mix.rows.length === 0

  // The three admin-aggregate reads (mix ← usage/funding, finance, credit) share the ONE
  // `getAdminGate`: a 403 on any means "not authorized for this admin surface" → the
  // operator panel, not a per-section error. Evals 403s are org-enablement, handled
  // per-section. Placed AFTER every hook so the hook order is stable across renders.
  const forbidden =
    (mixErr && isForbidden(mixErr)) || (financeErr && isForbidden(financeErr)) || (creditErr && isForbidden(creditErr))
  if (forbidden) {
    return (
      <YStack p="$4" gap="$4">
        <PageHeader title="AI Economics" />
        <SuperAdminRequired />
      </YStack>
    )
  }

  return (
    <YStack p="$4" gap="$6" testID="ai-economics">
      <PageHeader
        title="AI Economics"
        subtitle="The model request mix, unit economics, and the eval → training flywheel across the fleet. Global-admin only."
        actions={
          <XStack items="center" gap="$2">
            <RangeTabs value={range} onChange={onRange} />
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={loadAll}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {/* ── (a) Model mix — THE KEY ── */}
      <YStack gap="$3" testID="model-mix">
        <SectionHead title="Model mix" sub="How many requests hit each model, and its share, tokens, and cost over the window." />

        <XStack gap="$3" flexWrap="wrap">
          <MetricCard icon={<Activity size={16} />} label="Requests" value={mix ? compactNumber(mix.total.requests) : '—'} caption={mix ? `across ${mix.models} model${mix.models === 1 ? '' : 's'}` : 'loading'} />
          <MetricCard icon={<Cpu size={16} />} label="Tokens" value={mix ? compactNumber(mix.total.tokens) : '—'} caption="total in window" />
          <MetricCard icon={<Coins size={16} />} label="Spend" value={mix ? usd(mix.total.costCents) : '—'} caption="upstream inference cost" />
          <MetricCard icon={<Boxes size={16} />} label="Providers" value={mix ? String(mix.providers) : '—'} caption="distinct upstreams" />
        </XStack>

        {mixErr && !mix ? (
          <ErrorState err={mixErr} onRetry={() => loadMix(range)} />
        ) : noMix ? (
          <NoteCard title="No model traffic in this window">
            <Text fontSize="$2" color="$color10">
              No inference requests were metered for the selected range. Widen the range, or check back once traffic flows.
            </Text>
          </NoteCard>
        ) : (
          <XStack gap="$4" flexWrap="wrap" items="flex-start">
            <Card p="$4" borderWidth={1} borderColor="$borderColor" minW={280} flex={1}>
              <Text fontSize="$3" color="$color11" mb="$3">
                Requests by model
              </Text>
              <Donut
                slices={mixSlices}
                size={168}
                thickness={24}
                legend
                center={
                  <YStack items="center">
                    <Text fontSize="$1" color="$color10">
                      requests
                    </Text>
                    <Text className="hz-mono" fontSize="$4" fontWeight="700" color="$color12">
                      {mix ? compactNumber(mix.total.requests) : '—'}
                    </Text>
                  </YStack>
                }
              />
            </Card>
            <YStack flex={2} minW={340} gap="$2">
              <Text fontSize="$3" color="$color11">
                Requests, share, tokens &amp; cost by model
              </Text>
              <DataTable<MixDisplayRow>
                columns={mixCols}
                rows={mixRows}
                loading={loading && !mix}
                empty="No model usage."
                rowKey={(r) => (r._total ? '__total__' : `${r.provider}/${r.model}`)}
              />
            </YStack>
          </XStack>
        )}
      </YStack>

      {/* ── (b) Profitability ── */}
      <YStack gap="$3">
        <SectionHead
          title="Profitability"
          sub="Upstream cost vs revenue, gross margin, and runway — plus each provider's credit position."
          right={
            derived ? (
              <Pill tone={marginTone(marginPct)}>{derived.profitable ? 'Profitable' : 'Not yet profitable'}</Pill>
            ) : undefined
          }
        />

        {financeErr && !finance ? (
          <ErrorState err={financeErr} onRetry={loadFinance} />
        ) : (
          <XStack gap="$3" flexWrap="wrap" testID="margin-card">
            <MetricCard icon={<TrendingUp size={16} />} label="MRR" value={revenue ? usd(revenue.mrrCents) : '—'} caption="monthly recurring" />
            <MetricCard icon={<Wallet size={16} />} label="Revenue" value={revenue ? usd(revenue.totalRevenueCents) : '—'} caption="total to date" />
            <MetricCard icon={<Flame size={16} />} label="Upstream cost" value={cost ? usd(cost.totalCents) : '—'} caption="what we pay vendors (COGS)" />
            <MetricCard
              icon={<Scale size={16} />}
              label="Gross margin"
              value={derived ? usd(derived.grossMarginCents) : '—'}
              caption={derived ? `${marginPctLabel(marginPct)} margin` : 'loading'}
            />
            <MetricCard icon={<Gauge size={16} />} label="Runway" value={derived ? runwayLabel(derived.runwayDays) : '—'} caption="at current burn" />
          </XStack>
        )}

        <YStack gap="$2">
          <Text fontSize="$3" color="$color11">
            Provider credit position
          </Text>
          {creditErr && !credit ? (
            <ErrorState err={creditErr} onRetry={loadCredit} />
          ) : credit && credit.length === 0 ? (
            <NoteCard title="No provider credit reported">
              <Text fontSize="$2" color="$color10">
                No upstream provider is reporting a credit grant yet. Providers appear here as credit is granted or keys are added.
              </Text>
            </NoteCard>
          ) : (
            <DataTable<ProviderCredit>
              columns={creditCols}
              rows={creditRows}
              loading={loading && !credit}
              empty="No provider credit."
              rowKey={(c) => c.provider || Math.random().toString()}
            />
          )}
        </YStack>
      </YStack>

      {/* ── (c) Training data — the HONEST collection card ── */}
      <YStack gap="$3">
        <SectionHead title="Training data" sub="What training data the platform actually holds — honestly." />

        <XStack gap="$3" flexWrap="wrap">
          <MetricCard icon={<Database size={16} />} label="Eval datasets" value={datasets ? String(ds.datasets) : '—'} caption="user-curated" />
          <MetricCard icon={<ScrollText size={16} />} label="Dataset items" value={datasets ? compactNumber(ds.items) : '—'} caption="input / expected pairs" />
        </XStack>

        <NoteCard title="No traffic is harvested for training" testid="training-collection-card">
          <Text fontSize="$3" color="$color11">
            The metering ledger (<Text className="hz-mono">hanzo.cloud_usage</Text> on our datastore) records one row per
            inference call with token counts and cost — and <Text fontWeight="700">no prompt or completion content</Text>.
            Nothing collects prompts or completions from live traffic, and there is no consent flag anywhere to do so.
          </Text>
          <Text fontSize="$3" color="$color11">
            The only training data the platform holds is the eval dataset registry below — input/expected pairs a human
            uploaded — plus whatever an org feeds <Text className="hz-mono">/v1/training</Text> directly. Those are the
            curated sources the router and fine-tunes learn from; the numbers above are the real registry counts, never a
            fabricated pipeline.
          </Text>
          {datasetsErr && !datasets ? (
            <Text fontSize="$2" color="$color10">
              (Eval registry not reachable on this host right now — counts show once <Text className="hz-mono">/v1/evals</Text> is routed.)
            </Text>
          ) : null}
        </NoteCard>

        {/* Training plane — not proxied through the console; link to the admin-gated engine. */}
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2">
          <XStack items="center" gap="$2">
            <Cpu size={16} color="$color11" />
            <Text fontSize="$4" fontWeight="600" color="$color12">
              Training plane
            </Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            The live fine-tune / RL plane (forward-backward + optim steps per client) runs on the engine at{' '}
            <Text className="hz-mono">api.hanzo.ai/v1/training</Text>, admin-gated. It is not proxied through this console,
            so client counts are read there directly rather than mirrored here.
          </Text>
          <a href="https://api.hanzo.ai/v1/training/clients" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <XStack items="center" gap="$1.5" self="flex-start">
              <ExternalLink size={13} color="$color10" />
              <Text fontSize="$2" style={{ color: 'var(--color10)' }}>
                api.hanzo.ai/v1/training/clients
              </Text>
            </XStack>
          </a>
        </Card>
      </YStack>

      {/* ── (d) Evals ── */}
      <YStack gap="$3">
        <SectionHead
          title="Evals"
          sub="Recent LLM-as-judge dataset runs — the quality signal the router learns from."
          right={
            <XStack gap="$4" items="center">
              <StepFact label="Datasets" value={datasets ? String(ds.datasets) : '—'} />
              <StepFact label="Evaluators" value={evaluators ? String(evaluators.length) : '—'} />
              <StepFact label="Runs" value={runs ? String(runs.length) : '—'} />
            </XStack>
          }
        />

        {runsErr && !runs ? (
          <ErrorState err={runsErr} onRetry={loadEvals} />
        ) : runs && runs.length === 0 ? (
          <NoteCard title="No eval runs yet">
            <Text fontSize="$2" color="$color10">
              No dataset runs have been recorded for this org. A run scores a model against a dataset with a judge model;
              its scores feed the router training loop below.
            </Text>
          </NoteCard>
        ) : (
          <DataTable<EvalDatasetRun>
            columns={runCols}
            rows={runsRecent}
            loading={loading && !runs}
            empty="No eval runs."
            rowKey={(r) => `${r.dataset ?? ''}/${r.runName ?? ''}/${r.createdAt ?? ''}`}
          />
        )}
      </YStack>

      {/* ── (e) Router training loop ── */}
      <YStack gap="$3">
        <SectionHead title="Router training loop" sub="How the eval signal folds into the enso router — offline profile + online per-user drift." />

        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$4">
          <XStack gap="$3" flexWrap="wrap" items="flex-start">
            {[
              { icon: <FlaskConical size={16} color="$color11" />, step: '1 · Eval', body: 'LLM-as-judge scores a model on a dataset → per-item quality + latency + cost.' },
              { icon: <ScrollText size={16} color="$color11" />, step: '2 · Sample', body: 'Scores fold into EvalSample JSONL {task, modality, approx_tokens, model, level, quality, latency_ms, cost}.' },
              { icon: <Brain size={16} color="$color11" />, step: '3 · Profile', body: 'Offline: samples build a ProfileTable and a ridge-regression weight W over model/level features.' },
              { icon: <Route size={16} color="$color11" />, step: '4 · Route', body: 'Online: enso serves the profile and drifts per-user with LinUCB rewards (Enso::observe).' },
            ].map((s) => (
              <YStack key={s.step} flex={1} minW={200} gap="$1.5">
                <XStack items="center" gap="$2">
                  {s.icon}
                  <Text fontSize="$3" fontWeight="700" color="$color12">
                    {s.step}
                  </Text>
                </XStack>
                <Text fontSize="$2" color="$color10">
                  {s.body}
                </Text>
              </YStack>
            ))}
          </XStack>

          <XStack gap="$5" flexWrap="wrap" borderTopWidth={1} borderColor="$borderColor" pt="$3">
            <StepFact label="Datasets" value={datasets ? String(ds.datasets) : '—'} />
            <StepFact label="Dataset items" value={datasets ? compactNumber(ds.items) : '—'} />
            <StepFact label="Evaluators" value={evaluators ? String(evaluators.length) : '—'} />
            <StepFact label="Runs scored" value={runs ? String(runs.length) : '—'} />
          </XStack>

          <XStack style={{ backgroundColor: TONE.warn.bg }} p="$3" rounded="$4" gap="$2" items="flex-start">
            <ArrowUpRight size={15} color={toneColor('warning')} style={{ marginTop: 2 }} />
            <Text fontSize="$2" style={{ color: TONE.warn.fg }}>
              Per-request reward signal: not yet persisted. The offline profile uses eval scores today; the online LinUCB
              loop needs a per-request quality/reward written back — the known missing signal on the roadmap. Live numbers
              above reflect only what exists.
            </Text>
          </XStack>
        </Card>
      </YStack>
    </YStack>
  )
}
