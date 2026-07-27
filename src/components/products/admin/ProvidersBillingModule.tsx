'use client'

/**
 * admin.hanzo.ai PROVIDER BILLING board — per-provider credit position + the
 * credit-vs-paid usage split. GLOBAL-ADMIN ONLY (`admin: true`; `/v1/admin/
 * {providers,usage}` are server-gated by `getAdminGate`). The ECONOMIC sibling of
 * the AI-Providers routing board (`ProviderAdminModule`, which flips State/
 * IsDefault): this one answers "how much of each provider's credit remains, what's
 * the burn/runway, and how does spend split across OUR-credit / paid / paid-only /
 * BYO".
 *
 * Two real `/v1/admin` reads (`ProviderBillingApi`), each honest end to end:
 *   1. Per-provider credit cards — remaining balance, burn rate, runway_days, and a
 *      has-credit / paid-only badge. Money is tabular-nums (`hz-mono`).
 *   2. Credit-vs-paid usage split — tokens / cost / requests by funding class over a
 *      selectable range (KPI band + donut + table).
 *
 * Renders gracefully for an empty OR one-provider set (DO is the only funded
 * provider today; the others slot in as keys drop). Never fabricates a number.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Coins, CreditCard, Flame, Gauge, RefreshCw, Server, Wallet } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import {
  ProviderBillingApi,
  type ProviderCredit,
  type FundingRow,
  usd,
  compactNumber,
  runwayLabel,
  runwayTone,
  creditBadge,
  creditSummary,
  foldFunding,
  fundingLabel,
  fundingColor,
} from '~/lib/api/provider-billing'
import type { RangeKey } from '~/lib/api/aimetrics'
import { PageHeader } from '@hanzo/ui/product'
import { MetricCard } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { Donut } from '@hanzo/ui/product'
import { RangeTabs } from '~/components/products/billing/RangeTabs'
import { ErrorState, asApiError, isForbidden, OperatorAccessRequired } from '~/components/ui/States'

// ── small presentational helpers ──────────────────────────────────────────────

const BADGE_TONE: Record<'credit' | 'paid' | 'empty', { bg: string; fg: string }> = {
  credit: { bg: 'rgba(35,197,98,0.14)', fg: '#23c562' },
  paid: { bg: 'rgba(255,159,69,0.16)', fg: '#ff9f45' },
  empty: { bg: 'rgba(148,163,184,0.16)', fg: '#94a3b8' },
}

function Pill({ tone, children }: { tone: 'credit' | 'paid' | 'empty'; children: string }) {
  const c = BADGE_TONE[tone]
  // Arbitrary rgba/hex go through `style` (the Tamagui bg/color props take only
  // theme tokens + hex LITERALS, per the Charts.tsx convention).
  return (
    <XStack style={{ backgroundColor: c.bg }} px="$2.5" py="$1" rounded="$10" items="center">
      <Text fontSize="$1" fontWeight="700" style={{ color: c.fg, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {children}
      </Text>
    </XStack>
  )
}

/** Runway urgency color — undefined = the calm default token; hex for warn/crit. */
const RUNWAY_COLOR: Record<'ok' | 'warn' | 'crit', string | undefined> = { ok: undefined, warn: '#ff9f45', crit: '#e5534b' }

function Fact({ icon, label, value, valueColor }: { icon: React.ReactNode; label: string; value: string; valueColor?: string }) {
  return (
    <YStack gap="$1" minW={96}>
      <XStack items="center" gap="$1.5">
        {icon}
        <Text fontSize="$1" color="$color10">
          {label}
        </Text>
      </XStack>
      <Text className="hz-mono" fontSize="$5" fontWeight="600" color="$color12" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </Text>
    </YStack>
  )
}

/** One provider's credit card — balance, burn, runway, has-credit/paid-only badge. */
function ProviderCreditCard({ c }: { c: ProviderCredit }) {
  const badge = creditBadge(c)
  return (
    <Card
      p="$4"
      gap="$3"
      borderWidth={1}
      borderColor="$borderColor"
      flex={1}
      minW={260}
      maxW={440}
      data-testid="provider-credit-card"
    >
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$2" flex={1} minW={0}>
          <Server size={16} color="$color11" />
          <Text fontSize="$5" fontWeight="700" color="$color12" numberOfLines={1}>
            {c.provider || 'unknown'}
          </Text>
        </XStack>
        <Pill tone={badge.tone}>{badge.label}</Pill>
      </XStack>

      <YStack gap="$0.5">
        <Text className="hz-mono" fontSize="$9" fontWeight="700" color={c.hasCredit ? '#23c562' : '$color12'} numberOfLines={1}>
          {usd(c.remainingCents)}
        </Text>
        <Text fontSize="$2" color="$color10">
          remaining of <Text className="hz-mono">{usd(c.grantCents)}</Text> granted
        </Text>
      </YStack>

      <XStack gap="$5" flexWrap="wrap">
        <Fact icon={<Flame size={13} color="$color10" />} label="Burn / day" value={usd(c.burnCents)} />
        <Fact
          icon={<Gauge size={13} color="$color10" />}
          label="Runway"
          value={runwayLabel(c.runwayDays)}
          valueColor={RUNWAY_COLOR[runwayTone(c.runwayDays)]}
        />
      </XStack>
    </Card>
  )
}

/** A small colored dot (funding-class legend / MetricCard icon). */
const Dot = ({ color }: { color: string }) => <YStack width={10} height={10} rounded="$10" style={{ backgroundColor: color }} />

/** An honest inline empty note (lighter than the full-page EmptyState). */
function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$1" maxWidth={620}>
      <Text fontSize="$4" fontWeight="600" color="$color12">
        {title}
      </Text>
      <Text fontSize="$2" color="$color10">
        {body}
      </Text>
    </Card>
  )
}

// ── module ────────────────────────────────────────────────────────────────────

export function ProvidersBillingModule() {
  const [credit, setCredit] = useState<ProviderCredit[] | null>(null)
  const [creditErr, setCreditErr] = useState<ApiError | null>(null)
  const [funding, setFunding] = useState<FundingRow[] | null>(null)
  const [fundingErr, setFundingErr] = useState<ApiError | null>(null)
  const [range, setRange] = useState<RangeKey>('7d')
  const [loading, setLoading] = useState(true)

  const loadCredit = useCallback(async () => {
    setCreditErr(null)
    try {
      setCredit(await ProviderBillingApi.credit())
    } catch (e) {
      setCreditErr(asApiError(e))
    }
  }, [])

  const loadFunding = useCallback(async (r: RangeKey) => {
    setFundingErr(null)
    try {
      setFunding(await ProviderBillingApi.funding(r))
    } catch (e) {
      setFundingErr(asApiError(e))
    }
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.allSettled([loadCredit(), loadFunding(range)])
    setLoading(false)
  }, [loadCredit, loadFunding, range])

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onRange = useCallback(
    (r: RangeKey) => {
      setRange(r)
      void loadFunding(r)
    },
    [loadFunding],
  )

  const summary = useMemo(() => creditSummary(credit ?? []), [credit])
  const fold = useMemo(() => foldFunding(funding ?? []), [funding])
  const fundingRows = useMemo(
    () => [...(funding ?? [])].sort((a, b) => b.costCents - a.costCents || b.tokens - a.tokens),
    [funding],
  )

  // Both reads share the ONE admin gate: a 403 on either means "not authorized for
  // this admin surface" — show the operator panel, not a per-section error.
  const forbidden = (creditErr && isForbidden(creditErr)) || (fundingErr && isForbidden(fundingErr))
  if (forbidden) {
    return (
      <YStack p="$4" gap="$4">
        <PageHeader title="Provider billing" />
        <OperatorAccessRequired />
      </YStack>
    )
  }

  const fundingCols: Column<FundingRow>[] = [
    {
      key: 'provider',
      header: 'Provider',
      render: (r) => (
        <Text fontSize="$3" color="$color12">
          {r.provider || '—'}
        </Text>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      render: (r) => (
        <Text fontSize="$2" color="$color11" numberOfLines={1}>
          {r.model || '—'}
        </Text>
      ),
    },
    {
      key: 'funding',
      header: 'Funding',
      render: (r) => (
        <XStack items="center" gap="$1.5">
          <Dot color={fundingColor(r.funding)} />
          <Text fontSize="$2" color="$color11">
            {fundingLabel(r.funding)}
          </Text>
        </XStack>
      ),
    },
    { key: 'tokens', header: 'Tokens', align: 'right', mono: true, render: (r) => <Text className="hz-mono" fontSize="$2" color="$color11">{compactNumber(r.tokens)}</Text> },
    { key: 'costCents', header: 'Cost', align: 'right', mono: true, render: (r) => <Text className="hz-mono" fontSize="$2" color="$color12">{usd(r.costCents)}</Text> },
    { key: 'requests', header: 'Requests', align: 'right', mono: true, render: (r) => <Text className="hz-mono" fontSize="$2" color="$color11">{compactNumber(r.requests)}</Text> },
  ]

  const knownClasses = fold.costSlices // ordered credit→paid→paid_only→byo→other
  const noFunding = funding !== null && funding.length === 0

  return (
    <YStack p="$4" gap="$5">
      <PageHeader
        title="Provider billing"
        subtitle="Per-provider credit balance, burn, and runway, plus the credit-vs-paid usage split across the fleet. Global-admin only."
        actions={
          <Button size="$3" icon={<RefreshCw size={15} />} onPress={loadAll}>
            Refresh
          </Button>
        }
      />

      {/* ── Section 1: provider credit ── */}
      <YStack gap="$3">
        <Text fontSize="$5" fontWeight="600" color="$color12">
          Provider credit
        </Text>

        {/* headline aggregate — reads at a glance even with one provider */}
        <XStack gap="$3" flexWrap="wrap">
          <MetricCard icon={<Wallet size={16} />} label="Remaining credit" value={credit ? usd(summary.totalRemainingCents) : '—'} caption={credit ? `across ${summary.providersWithCredit} funded provider${summary.providersWithCredit === 1 ? '' : 's'}` : 'loading'} />
          <MetricCard icon={<CreditCard size={16} />} label="Granted" value={credit ? usd(summary.totalGrantCents) : '—'} caption="total credit granted" />
          <MetricCard icon={<Flame size={16} />} label="Burn / day" value={credit ? usd(summary.totalBurnCents) : '—'} caption="current daily burn" />
          <MetricCard icon={<Gauge size={16} />} label="Min runway" value={credit ? runwayLabel(summary.minRunwayDays) : '—'} caption="the provider that runs out first" />
        </XStack>

        {creditErr && !credit ? (
          <ErrorState err={creditErr} onRetry={loadCredit} />
        ) : credit && credit.length === 0 ? (
          <EmptyNote title="No provider credit yet" body="No upstream provider is reporting a credit grant. Providers appear here as credit is granted or keys are added." />
        ) : (
          <XStack gap="$3" flexWrap="wrap">
            {(credit ?? []).map((c) => (
              <ProviderCreditCard key={c.provider || Math.random()} c={c} />
            ))}
            {!credit ? <Text color="$color10">Loading…</Text> : null}
          </XStack>
        )}
      </YStack>

      {/* ── Section 2: credit-vs-paid usage split ── */}
      <YStack gap="$3">
        <XStack items="center" justify="space-between" flexWrap="wrap" gap="$2">
          <YStack>
            <Text fontSize="$5" fontWeight="600" color="$color12">
              Credit vs paid usage
            </Text>
            <Text fontSize="$2" color="$color10">
              How spend splits across our credit, paid, paid-only, and BYO.
            </Text>
          </YStack>
          <RangeTabs value={range} onChange={onRange} />
        </XStack>

        {fundingErr && !funding ? (
          <ErrorState err={fundingErr} onRetry={() => loadFunding(range)} />
        ) : noFunding ? (
          <EmptyNote title="No usage in this window" body="No billed usage was recorded for the selected range. Widen the range, or check back once traffic flows." />
        ) : (
          <>
            {/* per-class KPI band */}
            <XStack gap="$3" flexWrap="wrap">
              <MetricCard
                icon={<Coins size={16} />}
                label="Total spend"
                value={funding ? usd(fold.total.costCents) : '—'}
                caption={funding ? `${compactNumber(fold.total.tokens)} tokens · ${compactNumber(fold.total.requests)} requests` : 'loading'}
              />
              {knownClasses.map((s) => (
                <MetricCard
                  key={s.label}
                  icon={<Dot color={s.color} />}
                  label={s.label}
                  value={usd(s.value)}
                  caption={`${Math.round((s.value / (fold.total.costCents || 1)) * 100)}% of spend`}
                  sparkColor={s.color}
                />
              ))}
            </XStack>

            {/* donut + table */}
            <XStack gap="$4" flexWrap="wrap" items="flex-start">
              <Card p="$4" borderWidth={1} borderColor="$borderColor" minW={280} flex={1}>
                <Text fontSize="$3" color="$color11" mb="$3">
                  Cost by funding
                </Text>
                <Donut
                  slices={fold.costSlices.map((s) => ({ label: s.label, value: s.value, color: s.color, hint: s.hint }))}
                  size={168}
                  thickness={24}
                  legend
                  center={
                    <YStack items="center">
                      <Text fontSize="$1" color="$color10">
                        total
                      </Text>
                      <Text className="hz-mono" fontSize="$4" fontWeight="700" color="$color12">
                        {usd(fold.total.costCents)}
                      </Text>
                    </YStack>
                  }
                />
              </Card>
              <YStack flex={2} minW={320} gap="$2">
                <Text fontSize="$3" color="$color11">
                  Usage by provider &amp; model
                </Text>
                <DataTable<FundingRow>
                  columns={fundingCols}
                  rows={fundingRows}
                  loading={loading && !funding}
                  empty="No usage rows."
                  rowKey={(r) => `${r.provider}/${r.model}/${r.funding}`}
                />
              </YStack>
            </XStack>
          </>
        )}
      </YStack>
    </YStack>
  )
}
