'use client'

/**
 * Billing overview — the GCP-billing-home of the console: the big numbers a
 * finance owner opens for first (cloud credit, month-to-date spend, a clearly
 * LABELLED linear projection) and a real spend-over-time trend.
 *
 * All real: balance = the ONE shared live cloud-credit value (`useCloudBalance`,
 * identical to the sidebar/Wallet); spend + trend = the commerce usage ledger
 * (`GET /v1/billing/usage` via the per-tenant `/billing` proxy) rolled up by the
 * pure `monthToDate`/`dailySpend`. Honest states everywhere — a 404/501 on usage
 * degrades the spend cards + chart to a truthful notice, never a fabricated number.
 * The projection is a naive run-rate, labelled as such (never sold as a forecast).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { CreditCard, TrendingUp, RefreshCw, Plus, ArrowRight, CalendarClock } from '@hanzogui/lucide-icons-2'

import { fetchUsageRecords, type UsageRecord, type RangeKey } from '~/lib/api/aimetrics'
import { useCloudBalance, spendableCents } from '~/lib/billing/live-balance'
import { useTimedOut } from '~/lib/use-timed-out'
import { BarChart } from '~/components/ui/Charts'
import { monthToDate, dailySpend, groupSpend, tileView, TILE_LOAD_TIMEOUT_MS } from './logic'
import { RangeTabs } from './RangeTabs'
import { BackendStateCard, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { usd } from '~/lib/money'

const MONTH = new Date().toLocaleDateString(undefined, { month: 'long' })
/** Honest fallback when a usage load outlives its budget (a hung request, not a thrown error). */
const TIMEOUT_STATE: BackendState = {
  kind: 'error',
  message: 'The billing service is taking too long to respond — retrying.',
}

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

/** A GCP-style big-number tile. */
function BigCard({
  icon,
  title,
  value,
  caption,
}: {
  icon: ReactNode
  title: string
  value: ReactNode
  caption?: ReactNode
}) {
  return (
    <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" flex={1} minW={240}>
      <XStack items="center" gap="$2">
        {icon}
        <Text fontSize="$5" fontWeight="700">
          {title}
        </Text>
      </XStack>
      {value}
      {caption ? (
        <Text fontSize="$2" color="$color11">
          {caption}
        </Text>
      ) : null}
    </Card>
  )
}

export function BillingOverview(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const { phase: balPhase, balance: bal, error: balError, refresh: refreshBal } = useCloudBalance()
  const [range, setRange] = useState<RangeKey>('30d')
  const [usage, setUsage] = useState<Async<UsageRecord[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    refreshBal()
    setUsage({ phase: 'loading' })
    fetchUsageRecords()
      .then((data) => setUsage({ phase: 'ready', data }))
      .catch((e) => setUsage({ phase: 'error', error: classifyBackend(e) }))
  }, [refreshBal])

  useEffect(() => {
    load()
  }, [load])

  // Bounded loading — the fix for "billing spins on Loading… forever through a
  // transient 502". If the balance or the usage fetch is still pending past the
  // budget (a deploy-window blip that leaves the request hung), the tiles stop
  // spinning and show the honest fallback, matching the Dashboard/Machines "—".
  const balTimedOut = useTimedOut(balPhase === 'loading' || balPhase === 'idle', TILE_LOAD_TIMEOUT_MS)
  const usageTimedOut = useTimedOut(usage.phase === 'loading', TILE_LOAD_TIMEOUT_MS)
  const usageView = tileView(usage.phase, usageTimedOut)
  const balFailed = balPhase === 'error' || balTimedOut

  const now = Date.now()
  const records = usage.phase === 'ready' ? usage.data : []
  const forecast = monthToDate(records, now)
  const trend = dailySpend(records, range, now)
  const topModels = groupSpend(records, 'model').slice(0, 5)

  return (
    <>
      <PageHeader
        title="Billing overview"
        subtitle="Balance, month-to-date spend, and a projected run-rate for your organization — billed to the same account the gateway debits."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <Button size="$2" theme="light" icon={<Plus size={14} />} onPress={() => router.push('/billing/credits')}>
              Add credits
            </Button>
          </XStack>
        }
      />

      {/* ── Big-number cards ─────────────────────────────────────────────────── */}
      <XStack flexWrap="wrap" gap="$3">
        <BigCard
          icon={<CreditCard size={16} />}
          title="Cloud credit"
          value={
            balPhase === 'ready' && bal ? (
              <Text fontSize="$9" fontWeight="900">
                {usd(spendableCents(bal) ?? bal.available)}
              </Text>
            ) : balPhase === 'noauth' ? (
              <Text fontSize="$3" color="$color11">Sign in to view your balance.</Text>
            ) : balPhase === 'unconfigured' ? (
              <Text fontSize="$3" color="$color11">Not available on this deployment yet.</Text>
            ) : balFailed ? (
              // Transient blip OR a load that outlived its budget — stop spinning,
              // show a "—" with the honest reason. The store keeps retrying with
              // backoff; the header Refresh button forces an immediate retry.
              <>
                <Text fontSize="$6" fontWeight="900" color="$color10">—</Text>
                <Text fontSize="$2" color="$color11">
                  Unavailable — retrying{balError ? ` · ${balError}` : ''}
                </Text>
              </>
            ) : (
              <Text fontSize="$3" color="$color11">Loading…</Text>
            )
          }
          caption={
            balPhase === 'ready' && bal
              ? `available · ${usd(bal.balance)} total · ${usd(bal.holds)} on hold`
              : undefined
          }
        />
        <BigCard
          icon={<TrendingUp size={16} />}
          title={`Spend in ${MONTH}`}
          value={
            usageView === 'ready' ? (
              <Text fontSize="$9" fontWeight="900">{usd(forecast.spentCents)}</Text>
            ) : usageView === 'failed' ? (
              <Text fontSize="$3" color="$color11">Appears once metering is reported.</Text>
            ) : (
              <Text fontSize="$3" color="$color11">Loading…</Text>
            )
          }
          caption={usageView === 'ready' ? `month-to-date · day ${forecast.dayOfMonth} of ${forecast.daysInMonth}` : undefined}
        />
        <BigCard
          icon={<CalendarClock size={16} />}
          title="Projected (linear)"
          value={
            usageView === 'ready' && forecast.projectedCents != null ? (
              <Text fontSize="$9" fontWeight="900">{usd(forecast.projectedCents)}</Text>
            ) : usageView === 'pending' ? (
              <Text fontSize="$3" color="$color11">Loading…</Text>
            ) : (
              // ready-but-no-basis OR a failed/timed-out load: an honest "—", never a spinner forever.
              <Text fontSize="$6" fontWeight="900" color="$color10">—</Text>
            )
          }
          caption={`estimated ${MONTH} total at the current run-rate — not a guarantee`}
        />
      </XStack>

      {/* ── Spend trend ──────────────────────────────────────────────────────── */}
      <YStack gap="$2">
        <XStack items="center" justify="space-between">
          <Text fontSize="$5" fontWeight="800" color="$color12">
            Daily spend
          </Text>
          <RangeTabs value={range} onChange={setRange} />
        </XStack>
        {usageView === 'failed' ? (
          <BackendStateCard
            state={usage.phase === 'error' ? usage.error : TIMEOUT_STATE}
            onRetry={load}
            hint="endpoint · GET /v1/billing/usage"
          />
        ) : (
          <Card p="$4" borderWidth={1} borderColor="$borderColor">
            {usageView === 'ready' ? (
              <BarChart data={trend} formatValue={(v) => `$${v.toFixed(2)}`} />
            ) : (
              <Text fontSize="$3" color="$color11">Loading…</Text>
            )}
          </Card>
        )}
      </YStack>

      {/* ── Top spend by model → Reports ─────────────────────────────────────── */}
      {usage.phase === 'ready' && topModels.length > 0 ? (
        <YStack gap="$2">
          <XStack items="center" justify="space-between">
            <Text fontSize="$5" fontWeight="800" color="$color12">
              Top spend by model
            </Text>
            <Button
              size="$2"
              chromeless
              iconAfter={<ArrowRight size={14} />}
              onPress={() => router.push('/billing/reports')}
            >
              Full report
            </Button>
          </XStack>
          <Card borderWidth={1} borderColor="$borderColor" overflow="hidden">
            {topModels.map((m, i) => (
              <XStack
                key={m.label}
                py="$2.5"
                px="$3"
                gap="$3"
                items="center"
                borderTopWidth={i === 0 ? 0 : 1}
                borderColor="$borderColor"
              >
                <Text flex={1} fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
                  {m.label}
                </Text>
                <Text width={110} fontSize="$2" color="$color11">
                  {m.requests.toLocaleString()} req
                </Text>
                <Text width={90} fontSize="$3" color="$color12" text="right">
                  {usd(m.cents)}
                </Text>
              </XStack>
            ))}
          </Card>
        </YStack>
      ) : null}
    </>
  )
}
