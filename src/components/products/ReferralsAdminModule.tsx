'use client'

/**
 * Referrals (admin) — the GLOBAL-ADMIN operator board over cloud-api's
 * `GET /v1/admin/referrals` + `POST /v1/admin/referrals/sweep` (cloud
 * `clients/referrals`). Every referral across the fleet with both orgs, statuses,
 * and the promo credit granted, plus a "Run sweep" action (the periodic qualify
 * path). Reads terminate at the global-admin-gated `app/admin/aggregate` proxy
 * (server 403 for a non-admin); the UI adds honest states, never a fabricated
 * ledger. `admin: true` hides the entry from every customer.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowRight, Coins, Gift, RefreshCw, Users, Zap } from '@hanzogui/lucide-icons-2'

import { AdminReferralsApi, type AdminReferralsView, type SweepResult } from '~/lib/api/admin-referrals'
import { MetricCard } from '~/components/ui/Metric'
import { asApiError, ErrorState, isForbidden, SuperAdminRequired } from '~/components/ui/States'
import { ApiError } from '~/lib/api'
import { shortDate, statusLabel, statusColor, usd } from './referrals/logic'
import { toneColor } from '~/components/ui/tone'
import { EmptyState, PageHeader } from '@hanzo/ui/product'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; data: T }

export function ReferralsAdminModule() {
  const [state, setState] = useState<Async<AdminReferralsView>>({ phase: 'loading' })
  const [sweeping, setSweeping] = useState(false)
  const [lastSweep, setLastSweep] = useState<SweepResult | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    AdminReferralsApi.list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const runSweep = useCallback(() => {
    setSweeping(true)
    AdminReferralsApi.sweep()
      .then((r) => {
        setLastSweep(r)
        load()
      })
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
      .finally(() => setSweeping(false))
  }, [load])

  return (
    <YStack gap="$3">
      <PageHeader
        title="Referrals"
        subtitle="Fleet-wide referral program — invites, qualification, and promo credit granted."
        actions={
          <XStack gap="$2" items="center" flexWrap="wrap">
            <Button
              size="$3"
             
              icon={<Zap size={15} />}
              onPress={runSweep}
              disabled={sweeping || state.phase === 'loading'}
            >
              {sweeping ? 'Sweeping…' : 'Run sweep'}
            </Button>
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={load} disabled={state.phase === 'loading'}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {lastSweep ? (
        <Text fontSize="$2" color="$color11">
          Last sweep: checked {lastSweep.swept} pending · credited {lastSweep.credited}.
        </Text>
      ) : null}

      {state.phase === 'loading' ? (
        <XStack p="$6" justify="center">
          <Text color="$color11">Loading referrals…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <SuperAdminRequired />
        ) : (
          <ErrorState
            err={state.err}
            onRetry={load}
            copy={{ notFound: 'The referrals aggregate is not routed on this deployment yet (GET /v1/admin/referrals).' }}
          />
        )
      ) : state.data.referrals.length === 0 ? (
        <EmptyState
          icon={Gift}
          title="No referrals yet"
          description="Referrals appear here as customers share their link and new organizations sign up."
          bullets={[
            'Source: GET /v1/admin/referrals — the cloud referrals store (Base/SQLite), global-admin only.',
            'Run a sweep to qualify-check pending referrals and grant the ones that now qualify.',
          ]}
        />
      ) : (
        <ReferralsAdminReady data={state.data} />
      )}
    </YStack>
  )
}

function ReferralsAdminReady({ data }: { data: AdminReferralsView }) {
  const s = data.summary
  return (
    <YStack gap="$4">
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Users size={16} color={toneColor('muted')} />} label="Referrals" value={String(s.total)} caption={`${s.signup} signed up`} />
        <MetricCard icon={<Gift size={16} color="$color11" />} label="Qualified" value={String(s.qualified + s.credited)} caption={`${s.credited} credited`} />
        <MetricCard icon={<Coins size={16} color={toneColor('warning')} />} label="Credit granted" value={usd(s.grantedCents)} caption="both sides, promo credit" />
      </XStack>

      <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
        <XStack px="$4" py="$3" bg="$color2" borderBottomWidth={1} borderColor="$borderColor" gap="$3">
          <Text flex={2} minW={200} fontSize="$2" fontWeight="700" color="$color11">
            Referrer → Referee
          </Text>
          <Text flex={1} minW={90} fontSize="$2" fontWeight="700" color="$color11">
            Code
          </Text>
          <Text flex={1} minW={90} fontSize="$2" fontWeight="700" color="$color11">
            Status
          </Text>
          <Text flex={1} minW={90} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Granted
          </Text>
          <Text flex={1} minW={90} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Signed up
          </Text>
        </XStack>
        {data.referrals.map((r) => (
          <XStack
            key={r.id}
            px="$4"
            py="$3"
            gap="$3"
            items="center"
            borderBottomWidth={1}
            borderColor="$borderColor"
            flexWrap="wrap"
          >
            <XStack flex={2} minW={200} items="center" gap="$2">
              <Text fontSize="$3" fontWeight="600" color="$color12">
                {r.referrerOrg}
              </Text>
              <ArrowRight size={13} color={toneColor('muted')} />
              <Text fontSize="$3" color="$color11">
                {r.refereeOrg}
              </Text>
            </XStack>
            <Text flex={1} minW={90} fontSize="$2" style={{ fontFamily: 'monospace' }} color="$color11">
              {r.code}
            </Text>
            <Text flex={1} minW={90} fontSize="$2" fontWeight="700" color={statusColor(r.status)}>
              {statusLabel(r.status)}
            </Text>
            <Text flex={1} minW={90} fontSize="$3" color="$color12" text="right">
              {r.referrerGrantCents + r.refereeGrantCents ? usd(r.referrerGrantCents + r.refereeGrantCents) : '—'}
            </Text>
            <Text flex={1} minW={90} fontSize="$2" color="$color10" text="right">
              {shortDate(r.createdAt)}
            </Text>
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}
