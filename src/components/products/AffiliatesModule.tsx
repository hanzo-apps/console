'use client'

/**
 * Affiliates — the customer partner-commission screen over the REAL cloud
 * `/v1/affiliates` surface (cloud `clients/affiliates`). Two states, one module:
 *  - NOT enrolled → an apply form (optional vanity code) + a plain-English explainer
 *    of the ongoing-commission deal.
 *  - Enrolled → a dashboard: status, your affiliate link (Copy), commission rate,
 *    four real stat tiles (referred / accrued / pending / paid), and your payout
 *    history. Every value is real or an honest empty/`—`; states are loading /
 *    BackendStateCard / honest empty — never a fabricated row. Org-scoped SERVER-SIDE
 *    (the `/v1` bearer proxy); no credential in the browser.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { BadgeCheck, Check, Coins, Copy, HandCoins, Handshake, RefreshCw, Users, Wallet } from '@hanzogui/lucide-icons-2'

import { AffiliatesApi, type AffiliateOverview } from '~/lib/api/affiliates'
import { MetricCard } from '~/components/ui/Metric'
import { payoutMethodLabel, ratePct, shortDate, statusLabel, statusColor, usd } from './affiliates/logic'
import { EarningsPanel, LinksPanel, LeaderboardPanel } from './affiliates/panels'
import { toneColor } from '~/components/ui/tone'
import { BackendStateCard, FieldRow, FieldText, PageHeader, PrimaryButton, classifyBackend, type BackendState } from '@hanzo/ui/product'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

export function AffiliatesModule() {
  const [state, setState] = useState<Async<AffiliateOverview>>({ phase: 'loading' })
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    AffiliatesApi.overview()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const copy = useCallback((link: string) => {
    try {
      void navigator.clipboard?.writeText(link)
    } catch {
      /* clipboard may be unavailable — the link is selectable in the field */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [])

  return (
    <YStack gap="$3">
      <PageHeader
        title="Affiliates"
        subtitle="Partner with Hanzo — earn ongoing commission on the customers you bring."
        actions={
          <Button size="$3" icon={<RefreshCw size={15} />} onPress={load} disabled={state.phase === 'loading'}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' && <Text color="$color10">Loading your affiliate program…</Text>}
      {state.phase === 'error' && (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/affiliates" />
      )}
      {state.phase === 'ready' &&
        (state.data.isAffiliate ? (
          <AffiliateDashboard data={state.data} copied={copied} onCopy={copy} />
        ) : (
          <AffiliateApply defaultRateBps={state.data.defaultRateBps} onApplied={load} />
        ))}
    </YStack>
  )
}

// ── apply (not yet enrolled) ──────────────────────────────────────────────────

function AffiliateApply({ defaultRateBps, onApplied }: { defaultRateBps: number; onApplied: () => void }) {
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback(() => {
    setSubmitting(true)
    setError(null)
    AffiliatesApi.apply(code.trim())
      .then(() => onApplied())
      .catch((e) => setError(e instanceof Error ? e.message : 'Your application was not submitted. Try again.'))
      .finally(() => setSubmitting(false))
  }, [code, onApplied])

  return (
    <YStack gap="$3">
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2">
          <Handshake size={18} color="$color11" />
          <Text fontSize="$5" fontWeight="700">
            Earn {ratePct(defaultRateBps)} commission — ongoing
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          As a Hanzo affiliate you get a partner link. Every organization that signs up through it is attributed to
          you, and you earn {ratePct(defaultRateBps)} of their metered spend — every period, for as long as they build
          on Hanzo. Applications are reviewed by our team before your link goes live.
        </Text>
        <YStack gap="$1">
          <FieldRow label="Preferred code (optional)">
            <FieldText
              value={code}
              onChange={setCode}
              disabled={submitting}
              placeholder="e.g. acme — your link becomes /?aff=acme"
            />
          </FieldRow>
          <Text fontSize="$1" color="$color10">
            3–32 chars of a–z, 0–9, hyphen. Leave blank and we’ll generate one. Staff confirm the code on approval.
          </Text>
        </YStack>
        {error ? (
          <Text fontSize="$2" color={toneColor('critical')}>
            {error}
          </Text>
        ) : null}
        <XStack>
          <PrimaryButton size="$3" icon={<Handshake size={15} />} onPress={apply} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Apply to become an affiliate'}
          </PrimaryButton>
        </XStack>
      </Card>

      <XStack gap="$3" flexWrap="wrap">
        <HowTile n="1" title="Apply" body="Request to join and (optionally) pick a vanity code." />
        <HowTile n="2" title="Get approved" body="Our team reviews and activates your partner link." />
        <HowTile n="3" title="Earn commission" body={`Referred customers’ spend earns you ${ratePct(defaultRateBps)}, every period.`} />
      </XStack>
    </YStack>
  )
}

function HowTile({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <Card flex={1} minW={200} p="$3.5" gap="$1.5" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$2">
        <YStack width={22} height={22} rounded="$10" bg="$color3" items="center" justify="center">
          <Text fontSize="$2" fontWeight="700" color="$color11">
            {n}
          </Text>
        </YStack>
        <Text fontSize="$3" fontWeight="700" color="$color12">
          {title}
        </Text>
      </XStack>
      <Text fontSize="$2" color="$color10">
        {body}
      </Text>
    </Card>
  )
}

// ── dashboard (enrolled) ──────────────────────────────────────────────────────

function AffiliateDashboard({
  data,
  copied,
  onCopy,
}: {
  data: AffiliateOverview
  copied: boolean
  onCopy: (link: string) => void
}) {
  const pending = data.status === 'approved'
  return (
    <YStack gap="$3">
      {/* Status + link */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2" justify="space-between" flexWrap="wrap">
          <XStack items="center" gap="$2">
            <BadgeCheck size={18} color={statusColor(data.status)} />
            <Text fontSize="$5" fontWeight="700">
              Affiliate · {ratePct(data.rateBps)} commission
            </Text>
          </XStack>
          <Text fontSize="$2" fontWeight="700" color={statusColor(data.status)}>
            {statusLabel(data.status)}
          </Text>
        </XStack>

        {data.status === 'applied' ? (
          <Text fontSize="$3" color="$color11">
            Your application is in review. You’ll get your partner link here as soon as our team approves it.
          </Text>
        ) : data.status === 'suspended' ? (
          <Text fontSize="$3" color="$color11">
            Your affiliate account is suspended, so your link no longer attributes new signups. Any commission you’ve
            already earned is unaffected. Contact support to reactivate.
          </Text>
        ) : (
          <Text fontSize="$3" color="$color11">
            Share your link. Every organization that signs up through it earns you {ratePct(data.rateBps)} of their spend, every
            period.
          </Text>
        )}

        {pending && data.link ? (
          <XStack gap="$2" items="center" flexWrap="wrap">
            <Card flex={1} minW={220} px="$3" py="$2.5" bg="$color2" borderWidth={1} borderColor="$borderColor" rounded="$3">
              <Text style={{ fontFamily: 'monospace' }} fontSize="$3" color="$color12">
                {data.link}
              </Text>
            </Card>
            <Button
              size="$3"
              icon={copied ? <Check size={15} /> : <Copy size={15} />}
              onPress={() => onCopy(data.link)}
              disabled={!data.link}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </XStack>
        ) : null}
        {data.code ? (
          <Text fontSize="$2" color="$color10">
            Your code: <Text style={{ fontFamily: 'monospace' }}>{data.code}</Text>
          </Text>
        ) : data.requestedCode ? (
          <Text fontSize="$2" color="$color10">
            Requested code: <Text style={{ fontFamily: 'monospace' }}>{data.requestedCode}</Text> (pending approval)
          </Text>
        ) : null}
      </Card>

      {/* Real stat tiles */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Users size={16} color={toneColor('muted')} />} label="Referred" value={String(data.referredCount)} caption="customers attributed" />
        <MetricCard icon={<HandCoins size={16} color="$color11" />} label="Accrued" value={usd(data.accruedCents)} caption="lifetime commission" />
        <MetricCard icon={<Coins size={16} color={toneColor('warning')} />} label="Pending" value={usd(data.pendingCents)} caption="awaiting payout" />
        <MetricCard icon={<Wallet size={16} color={toneColor('positive')} />} label="Paid out" value={usd(data.paidCents)} caption="commission paid" />
      </XStack>

      {/* Rewards, links, and leaderboard — only for a live (approved) affiliate. */}
      {data.status === 'approved' ? (
        <>
          <EarningsPanel />
          <LinksPanel />
          <LeaderboardPanel initialHandle={data.handle} />
        </>
      ) : null}

      {/* Payout history */}
      <Card p="$0" borderWidth={1} borderColor="$borderColor" overflow="hidden">
        <XStack px="$4" py="$3" borderBottomWidth={1} borderColor="$borderColor">
          <Text fontSize="$4" fontWeight="700">
            Payout history
          </Text>
        </XStack>
        {data.payouts.length === 0 ? (
          <YStack p="$5" items="center" gap="$2">
            <Wallet size={22} color={toneColor('muted')} />
            <Text fontSize="$3" color="$color11">
              No payouts yet
            </Text>
            <Text fontSize="$2" color="$color10">
              Commission is paid out by our team once it accrues. It’ll show up here.
            </Text>
          </YStack>
        ) : (
          <YStack>
            {data.payouts.map((p) => (
              <XStack
                key={p.id}
                px="$4"
                py="$3"
                items="center"
                justify="space-between"
                gap="$3"
                borderBottomWidth={1}
                borderColor="$borderColor"
                flexWrap="wrap"
              >
                <YStack gap="$1" flex={1} minW={180}>
                  <Text fontSize="$3" fontWeight="600" color="$color12">
                    {payoutMethodLabel(p.method)}
                    {p.reference ? (
                      <Text fontSize="$2" color="$color10">
                        {' '}
                        · {p.reference}
                      </Text>
                    ) : null}
                  </Text>
                  <Text fontSize="$2" color="$color10">
                    {shortDate(p.createdAt)}
                  </Text>
                </YStack>
                <Text fontSize="$3" fontWeight="700" color="$color12" minW={72} text="right">
                  {usd(p.amountCents)}
                </Text>
              </XStack>
            ))}
          </YStack>
        )}
      </Card>
    </YStack>
  )
}
