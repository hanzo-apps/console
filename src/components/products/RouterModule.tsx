'use client'

/**
 * Router — the per-org AI Usage & Training surface (registry `''` + `:tab`, AI
 * category). The customer face of the virtual `auto`/`zen-router` model, in three
 * tabs:
 *   Overview — routing observability + TRAINING status over `GET /v1/router/stats`
 *     (org-scoped): (a) cost saved (a blended $/MTok PROXY, not billed dollars),
 *     (b) a quality proxy (learned reward / learned share / confidence / shadow
 *     agreement), (c) the per-task routed-model distribution, the last-retrain gate
 *     verdict when present, and the opt-in training-contribution toggle (kept in
 *     THIS one place — the toggle lives nowhere else in the console).
 *   Usage    — the org's AI usage (native Hanzo `GET /v1/get-cloud-usages` +
 *     imported connected-provider usage), rendered by the shared `<AiUsagePanels>`
 *     that `AiUsageModule` also uses. ONE usage implementation — never a second copy.
 *   Policy   — the reused λ/µ editor (`RouterPolicyEditor`): task pools + cost
 *     ceiling. ONE editor, embedded here — never a second copy.
 *
 * Honest by construction: loading (`Loader`), failure (`BackendStateCard`), no
 * activity (`EmptyState`), and an em-dash for every absent/nullable metric. All
 * numbers come from the pure, tested `router/logic.ts` — nothing is fabricated.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, Coins, Gauge, GitBranch, PiggyBank, Route, ShieldCheck, Sparkles, TrendingDown, Waypoints } from '@hanzogui/lucide-icons-2'

import { RouterStatsApi, TrainingContributionApi, type RouterStats } from '~/lib/api/router'
import {
  normalizeStats,
  hasActivity,
  hasPricedCost,
  moneyIndex,
  fractionPct,
  savedPctLabel,
  rewardLabel,
  shadowAgreementLabel,
  modelSlices,
  taskBreakdown,
  throughputSeries,
  retrainLine,
  hoursFor,
  ROUTER_RANGES,
  type RouterRange,
  type NamedValue,
} from './router/logic'
import { RouterPolicyEditor } from './RouterPolicyEditor'
import { AiUsagePanels } from './usage/AiUsagePanels'
import { Loader } from '~/components/ui/Loader'
import { MetricCard } from '~/components/ui/Metric'
import { Panel } from '~/components/ui/Panel'
import { Donut, LineChart, type Slice } from '~/components/ui/Charts'
import { RAMP } from '~/lib/theme/ramp'
import { useToast } from '~/components/ui/Toast'
import { BackendStateCard, EmptyState, FieldSwitch, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

// Monochrome accent — design --neutral-300 (the console is monochrome by construction).
const ACCENT = 'var(--color11)'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }


/** Map a pure `NamedValue[]` to polychrome donut slices (color assigned in the view). */
const toSlices = (rows: NamedValue[]): Slice[] =>
  rows.map((r, i) => ({ label: r.label, value: r.value, color: RAMP[i % RAMP.length] }))

export function RouterModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = productSubpageSlug('router', params.tab)

  return (
    <>
      <SubNav id="router" />

      {tab === 'policy' ? (
        <RouterPolicyEditor params={params} />
      ) : tab === 'usage' ? (
        <AiUsagePanels
          title="AI usage"
          subtitle="Requests, tokens, spend, and per-model usage for your org — native Hanzo usage (GET /v1/get-cloud-usages), beside your connected-provider usage."
        />
      ) : (
        <RouterOverview />
      )}
    </>
  )
}

function RouterOverview() {
  const [range, setRange] = useState<RouterRange>('24h')
  const [state, setState] = useState<Async<RouterStats>>({ phase: 'loading' })

  const load = useCallback((r: RouterRange) => {
    setState({ phase: 'loading' })
    RouterStatsApi.get({ hours: hoursFor(r) })
      .then((raw) => setState({ phase: 'ready', data: normalizeStats(raw) }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load(range)
  }, [load, range])

  return (
    <>
      <PageHeader
        title="Router"
        subtitle="Where your org's requests went and why — which model answered each task, what it cost, and how the answers scored."
        actions={
          <XStack gap="$1" flexWrap="wrap">
            {ROUTER_RANGES.map((r) => (
              <Button
                key={r}
                size="$2"
                bg={r === range ? '$color5' : 'transparent'}
                borderWidth={1}
                borderColor="$borderColor"
                onPress={() => setRange(r)}
              >
                {r}
              </Button>
            ))}
          </XStack>
        }
      />

      {state.phase === 'loading' ? (
        <Loader label="Loading routing stats…" />
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={() => load(range)} hint="GET /v1/router/stats" />
      ) : (
        <RouterBoard stats={state.data} />
      )}
    </>
  )
}

function RouterBoard({ stats }: { stats: RouterStats }) {
  const router = useRouter()
  const cost = stats.cost
  const q = stats.quality
  const priced = hasPricedCost(stats)
  const tasks = useMemo(() => taskBreakdown(stats.by_task).slice(0, 6), [stats.by_task])
  const models = useMemo(() => modelSlices(stats.by_model), [stats.by_model])
  const series = useMemo(() => throughputSeries(stats), [stats])
  const shadow = shadowAgreementLabel(q)
  const retrain = retrainLine(stats)

  if (!hasActivity(stats)) {
    return (
      <YStack gap="$4">
        <EmptyState
          icon={Waypoints}
          title="No routing activity yet"
          description="Send traffic through the auto/zen-router model and cost-saved, quality, and per-task routing stats appear here."
          bullets={[
            'Point requests at the "auto" model (or any pooled task) to start routing.',
            'Set your task pools and cost ceiling in the Policy tab.',
          ]}
          primary={{ label: 'Edit routing policy', onPress: () => router.push('/router/policy') }}
        />
        <TrainingContributionCard />
      </YStack>
    )
  }

  return (
    <YStack gap="$4">
      {/* (a) Cost saved — a blended $/MTok PROXY, not billed dollars. */}
      <Panel title="Cost saved" grow={false}>
        <Text fontSize="$2" color="$color11" maxW={720}>
          A blended <Text style={{ fontFamily: 'monospace' }}>$/MTok</Text> proxy — the router ledger has no per-token
          counts, so this compares the served model's price index against the premium single model you'd default to
          without routing. Not billed dollars.
        </Text>
        <XStack gap="$3" flexWrap="wrap">
          <MetricCard
            icon={<PiggyBank size={16} color={ACCENT} />}
            label="Cost saved"
            value={savedPctLabel(stats)}
            caption={priced ? `${cost?.priced_events.toLocaleString()} priced events` : 'no priced events yet'}
          />
          <MetricCard
            icon={<TrendingDown size={16} color={ACCENT} />}
            label="Routed index"
            value={moneyIndex(cost?.routed_index)}
            caption="avg served $/MTok (proxy)"
          />
          <MetricCard
            icon={<Coins size={16} color={ACCENT} />}
            label="Counterfactual"
            value={moneyIndex(cost?.counterfactual_index)}
            caption={cost?.baseline_model ? `vs ${cost.baseline_model}` : 'premium single model'}
          />
          <MetricCard
            icon={<Coins size={16} color={ACCENT} />}
            label="Cumulative saved"
            value={priced ? moneyIndex(cost?.cumulative_saved_index) : '—'}
            caption="Σ per-request (cf − routed)"
          />
        </XStack>
      </Panel>

      {/* (b) Quality proxy. */}
      <Panel title="Quality proxy" grow={false}>
        <XStack gap="$3" flexWrap="wrap">
          <MetricCard
            icon={<Sparkles size={16} color={ACCENT} />}
            label="Reward rate"
            value={rewardLabel(q)}
            caption={`${q.rewarded_events.toLocaleString()} rewarded events`}
          />
          <MetricCard
            icon={<Gauge size={16} color={ACCENT} />}
            label="Learned share"
            value={fractionPct(q.learned_share)}
            caption="tuned table vs static seed"
          />
          <MetricCard
            icon={<Activity size={16} color={ACCENT} />}
            label="Avg confidence"
            value={fractionPct(q.avg_confidence)}
            caption="router decision confidence"
          />
          {shadow != null ? (
            <MetricCard
              icon={<ShieldCheck size={16} color={ACCENT} />}
              label="Shadow agreement"
              value={shadow}
              caption="live vs shadow model"
            />
          ) : (
            <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" flex={1} minW={172}>
              <XStack items="center" gap="$2">
                <ShieldCheck size={16} color="$color10" />
                <Text fontSize="$2" color="$color11" fontWeight="500">
                  Shadow agreement
                </Text>
              </XStack>
              <Text fontSize="$3" color="$color10">
                Not available yet
              </Text>
              <Text fontSize="$1" color="$color10">
                appears once a shadow model is scored
              </Text>
            </Card>
          )}
        </XStack>
      </Panel>

      {/* (c) Per-task routed-model distribution + routed models + throughput. */}
      <XStack gap="$4" flexWrap="wrap">
        <Panel title="Routed models" minW={300}>
          <Donut slices={toSlices(models)} legend center={<Text fontSize="$3" color="$color11">{stats.window.events.toLocaleString()}</Text>} />
        </Panel>
        <Panel title="Requests over time" minW={320}>
          <LineChart data={series} height={180} color={ACCENT} formatValue={(v) => v.toLocaleString()} />
        </Panel>
      </XStack>

      <Panel title="Routing by task" grow={false}>
        {tasks.length === 0 ? (
          <Text fontSize="$3" color="$color10">
            —
          </Text>
        ) : (
          <XStack gap="$4" flexWrap="wrap">
            {tasks.map((t) => (
              <YStack key={t.task} gap="$2" minW={220} flex={1}>
                <XStack items="center" justify="space-between" gap="$2">
                  <Text fontSize="$3" fontWeight="600" color="$color12">
                    {t.task}
                  </Text>
                  <Text fontSize="$1" color="$color10">
                    {t.events.toLocaleString()} events
                  </Text>
                </XStack>
                <Donut slices={toSlices(t.models)} size={132} thickness={18} legend />
              </YStack>
            ))}
          </XStack>
        )}
      </Panel>

      {/* (f) Last-retrain gate verdict, when present. */}
      {retrain ? (
        <Card p="$3" borderWidth={1} borderColor="$borderColor">
          <XStack gap="$2" items="center">
            <GitBranch size={15} color="$color10" />
            <Text fontSize="$2" color="$color11" flex={1}>
              {retrain}
            </Text>
          </XStack>
        </Card>
      ) : null}

      {/* (e) Opt-in training contribution. */}
      <TrainingContributionCard />
    </YStack>
  )
}

/**
 * The opt-in for improving the org's personal router with its OWN usage — feature
 * vectors only, never prompt text. Optimistic toggle with an honest revert on
 * failure; if the preference isn't served on this deployment it says so (never a
 * silent no-op that looks enabled).
 */
type FlagState =
  | { phase: 'loading' }
  | { phase: 'ready'; enabled: boolean }
  | { phase: 'unavailable'; note: string }

function TrainingContributionCard() {
  const toast = useToast()
  const [state, setState] = useState<FlagState>({ phase: 'loading' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    TrainingContributionApi.get()
      .then((r) => alive && setState({ phase: 'ready', enabled: !!r.enabled }))
      .catch((e) => alive && setState({ phase: 'unavailable', note: classifyBackend(e).message }))
    return () => {
      alive = false
    }
  }, [])

  const toggle = async (next: boolean) => {
    if (state.phase !== 'ready') return
    const prev = state.enabled
    setState({ phase: 'ready', enabled: next }) // optimistic
    setBusy(true)
    try {
      const r = await TrainingContributionApi.save(next)
      setState({ phase: 'ready', enabled: !!r.enabled })
      toast.success(r.enabled ? 'Contributing usage to routing' : 'Opted out of routing contribution')
    } catch (e) {
      setState({ phase: 'ready', enabled: prev }) // honest revert
      toast.error('Could not update preference', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack gap="$3" items="flex-start" justify="space-between" flexWrap="wrap">
        <YStack gap="$1.5" flex={1} minW={260}>
          <XStack items="center" gap="$2">
            <Route size={16} color={ACCENT} />
            <Text fontSize="$4" fontWeight="700">
              Improve routing with our usage
            </Text>
          </XStack>
          <Text fontSize="$2" color="$color11" maxW={640}>
            Opt in to help train your org's personal router. Feature vectors only — never prompt text, never raw
            requests. You can turn this off any time.
          </Text>
          {state.phase === 'unavailable' ? (
            <Text fontSize="$1" color="$color10">
              This preference isn't available on this deployment yet — it appears here once the route is live.
            </Text>
          ) : null}
        </YStack>
        {state.phase === 'loading' ? (
          <Text fontSize="$2" color="$color10">
            Loading…
          </Text>
        ) : state.phase === 'ready' ? (
          <FieldSwitch checked={state.enabled} onChange={toggle} disabled={busy} />
        ) : null}
      </XStack>
    </Card>
  )
}

