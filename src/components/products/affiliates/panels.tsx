'use client'

/**
 * Affiliate dashboard panels over the REAL cloud `/v1/affiliates` surface: the REWARDS
 * earnings chart (per-period share + per-referral contribution), the REFERRAL LINKS
 * manager (create + copy + click/signup/conversion stats), and the privacy-preserving
 * LEADERBOARD (opt-in handle, your own rank, aggregate only — never another org's
 * identity). Each panel self-fetches and degrades to an honest empty; every value is
 * real. Org-scoped SERVER-SIDE via the `/v1` bearer proxy — no credential in the browser.
 */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Check, Copy, Link2, Plus, TrendingUp, Trophy } from '@hanzogui/lucide-icons-2'

import {
  AffiliatesApi,
  type AffiliateLink,
  type Earnings,
  type Leaderboard,
  type LinksView,
} from '~/lib/api/affiliates'
import { LineChart, type ChartPoint } from '@hanzo/ui/product'
import { FieldRow, FieldText } from '@hanzo/ui/product'
import { PrimaryButton } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { monthLabel, ratePct, usd } from './logic'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

function useAsync<T>(fetcher: () => Promise<T>): { state: Async<T>; reload: () => void } {
  const [state, setState] = useState<Async<T>>({ phase: 'loading' })
  const reload = useCallback(() => {
    setState({ phase: 'loading' })
    fetcher()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return { state, reload }
}

function PanelCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$2">
        {icon}
        <Text fontSize="$4" fontWeight="700" color="$color12">
          {title}
        </Text>
      </XStack>
      {children}
    </Card>
  )
}

// ── Rewards / earnings ─────────────────────────────────────────────────────────

export function EarningsPanel() {
  const { state, reload } = useAsync<Earnings>(AffiliatesApi.earnings)

  const series: ChartPoint[] = useMemo(() => {
    if (state.phase !== 'ready') return []
    // The ledger returns newest-first; a chart reads oldest→newest, left→right.
    return state.data.byPeriod
      .slice()
      .reverse()
      .map((p) => ({ label: monthLabel(p.period), value: p.commissionCents }))
  }, [state])

  return (
    <PanelCard title="Rewards" icon={<TrendingUp size={18} color="#a371f7" />}>
      {state.phase === 'loading' && <Text color="$color10">Loading your earnings…</Text>}
      {state.phase === 'error' && (
        <BackendStateCard state={state.error} onRetry={reload} hint="endpoint · GET /v1/affiliates/me/earnings" />
      )}
      {state.phase === 'ready' && (
        <YStack gap="$3">
          <Text fontSize="$2" color="$color11">
            Your profit share is a slice of Hanzo’s margin ({ratePct(state.data.marginBps)} of what your referrals
            spend) — it comes out of Hanzo’s margin, never your customers’ bill.
          </Text>
          {series.length >= 2 ? (
            <LineChart data={series} formatValue={(v) => usd(v)} />
          ) : (
            <YStack height={120} items="center" justify="center" gap="$1">
              <Text fontSize="$3" color="$color11">
                No earnings history yet
              </Text>
              <Text fontSize="$2" color="$color10">
                Your monthly share appears here once your referred customers spend.
              </Text>
            </YStack>
          )}

          {state.data.byReferredOrg.length > 0 ? (
            <YStack gap="$2">
              <Text fontSize="$2" fontWeight="700" color="$color11">
                Top referrals by earnings
              </Text>
              {state.data.byReferredOrg.slice(0, 8).map((o) => (
                <XStack key={o.referredOrg} justify="space-between" items="center" gap="$3">
                  <Text fontSize="$2" color="$color11" style={{ fontFamily: 'monospace' }} numberOfLines={1}>
                    {o.referredOrg}
                  </Text>
                  <Text fontSize="$2" fontWeight="700" color="$color12">
                    {usd(o.commissionCents)}
                  </Text>
                </XStack>
              ))}
            </YStack>
          ) : null}
        </YStack>
      )}
    </PanelCard>
  )
}

// ── Referral links ─────────────────────────────────────────────────────────────

export function LinksPanel() {
  const { state, reload } = useAsync<LinksView>(AffiliatesApi.links)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const links = state.phase === 'ready' ? state.data.links : []
  const atCap = state.phase === 'ready' && links.length >= state.data.maxLinks
  const approved = state.phase === 'ready' && state.data.status === 'approved'

  const create = useCallback(() => {
    setBusy(true)
    setErr(null)
    AffiliatesApi.createLink(label.trim())
      .then(() => {
        setLabel('')
        reload()
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not create the link. Try again.'))
      .finally(() => setBusy(false))
  }, [label, reload])

  const copy = useCallback((url: string, code: string) => {
    try {
      void navigator.clipboard?.writeText(url)
    } catch {
      /* clipboard may be unavailable — the url is selectable */
    }
    setCopied(code)
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500)
  }, [])

  return (
    <PanelCard title="Referral links" icon={<Link2 size={18} color="#a371f7" />}>
      {state.phase === 'loading' && <Text color="$color10">Loading your links…</Text>}
      {state.phase === 'error' && (
        <BackendStateCard state={state.error} onRetry={reload} hint="endpoint · GET /v1/affiliates/me/links" />
      )}
      {state.phase === 'ready' && (
        <YStack gap="$3">
          {links.length === 0 ? (
            <Text fontSize="$2" color="$color10">
              No links yet. Create one below to start sharing.
            </Text>
          ) : (
            <YStack gap="$2.5">
              {links.map((l) => (
                <LinkRow key={l.code} link={l} copied={copied === l.code} onCopy={() => copy(l.url, l.code)} />
              ))}
            </YStack>
          )}

          {approved ? (
            <YStack gap="$2" borderTopWidth={1} borderColor="$borderColor" pt="$3">
              <FieldRow label="New link label (optional)">
                <FieldText value={label} onChange={setLabel} disabled={busy || atCap} placeholder="e.g. Twitter, newsletter" />
              </FieldRow>
              {err ? (
                <Text fontSize="$2" color="#f85149">
                  {err}
                </Text>
              ) : null}
              <XStack items="center" gap="$3" flexWrap="wrap">
                <PrimaryButton size="$3" icon={<Plus size={15} />} onPress={create} disabled={busy || atCap}>
                  {busy ? 'Creating…' : 'Create link'}
                </PrimaryButton>
                <Text fontSize="$1" color="$color10">
                  {atCap ? `Link limit reached (${state.data.maxLinks}).` : 'A fresh code is generated for each link.'}
                </Text>
              </XStack>
            </YStack>
          ) : null}
        </YStack>
      )}
    </PanelCard>
  )
}

function LinkRow({ link, copied, onCopy }: { link: AffiliateLink; copied: boolean; onCopy: () => void }) {
  return (
    <YStack gap="$2" p="$3" bg="$color2" borderWidth={1} borderColor="$borderColor" rounded="$3">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <YStack gap="$0.5" flex={1} minW={200}>
          <Text fontSize="$3" fontWeight="700" color="$color12">
            {link.label || 'Link'}
          </Text>
          <Text fontSize="$2" color="$color11" style={{ fontFamily: 'monospace' }} numberOfLines={1}>
            {link.url}
          </Text>
        </YStack>
        <Button size="$2" icon={copied ? <Check size={14} /> : <Copy size={14} />} onPress={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </XStack>
      <XStack gap="$4" flexWrap="wrap">
        <LinkStat label="Clicks" value={link.clicks} />
        <LinkStat label="Signups" value={link.signups} />
        <LinkStat label="Conversions" value={link.conversions} />
      </XStack>
    </YStack>
  )
}

function LinkStat({ label, value }: { label: string; value: number }) {
  return (
    <XStack gap="$1.5" items="baseline">
      <Text fontSize="$3" fontWeight="700" color="$color12">
        {Number.isFinite(value) ? String(value) : '—'}
      </Text>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
    </XStack>
  )
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

export function LeaderboardPanel({ initialHandle }: { initialHandle: string }) {
  const { state, reload } = useAsync<Leaderboard>(AffiliatesApi.leaderboard)
  const [handle, setHandle] = useState(initialHandle)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = useCallback(() => {
    setBusy(true)
    setErr(null)
    setSaved(false)
    AffiliatesApi.setHandle(handle.trim())
      .then((h) => {
        setHandle(h)
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
        reload()
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not save your handle. Try again.'))
      .finally(() => setBusy(false))
  }, [handle, reload])

  return (
    <PanelCard title="Leaderboard" icon={<Trophy size={18} color="#d29922" />}>
      {state.phase === 'loading' && <Text color="$color10">Loading the leaderboard…</Text>}
      {state.phase === 'error' && (
        <BackendStateCard state={state.error} onRetry={reload} hint="endpoint · GET /v1/affiliates/leaderboard" />
      )}
      {state.phase === 'ready' && (
        <YStack gap="$3">
          {state.data.you ? (
            <XStack
              items="center"
              justify="space-between"
              gap="$3"
              p="$3"
              bg="$color3"
              rounded="$3"
              flexWrap="wrap"
            >
              <Text fontSize="$3" fontWeight="700" color="$color12">
                Your rank: #{state.data.you.rank}
                {state.data.total > 0 ? <Text fontSize="$2" color="$color10"> {` of ${state.data.total}`}</Text> : null}
              </Text>
              <Text fontSize="$3" fontWeight="700" color="#a371f7">
                {usd(state.data.you.accruedCents)}
              </Text>
            </XStack>
          ) : null}

          {state.data.leaders.length === 0 ? (
            <Text fontSize="$2" color="$color10">
              No public leaderboard entries yet. Set a handle below to appear.
            </Text>
          ) : (
            <YStack>
              {state.data.leaders.map((row) => (
                <XStack
                  key={`${row.rank}-${row.handle}`}
                  items="center"
                  justify="space-between"
                  gap="$3"
                  py="$2"
                  borderBottomWidth={1}
                  borderColor="$borderColor"
                >
                  <XStack items="center" gap="$3" flex={1} minW={0}>
                    <Text fontSize="$3" fontWeight="700" color="$color10" width={34}>
                      #{row.rank}
                    </Text>
                    <Text
                      fontSize="$3"
                      fontWeight={row.isYou ? '700' : '600'}
                      color={row.isYou ? '#a371f7' : '$color12'}
                      numberOfLines={1}
                    >
                      {row.handle}
                      {row.isYou ? ' (you)' : ''}
                    </Text>
                  </XStack>
                  <Text fontSize="$2" color="$color10">
                    {row.referredCount} referred
                  </Text>
                  <Text fontSize="$3" fontWeight="700" color="$color12" minW={72} text="right">
                    {usd(row.accruedCents)}
                  </Text>
                </XStack>
              ))}
            </YStack>
          )}

          {/* Opt-in handle: setting one lists you publicly; clearing it hides your name. */}
          <YStack gap="$2" borderTopWidth={1} borderColor="$borderColor" pt="$3">
            <FieldRow label="Public handle (opt-in)">
              <FieldText value={handle} onChange={setHandle} disabled={busy} placeholder="e.g. buildwithme — leave blank to stay private" />
            </FieldRow>
            {err ? (
              <Text fontSize="$2" color="#f85149">
                {err}
              </Text>
            ) : null}
            <XStack items="center" gap="$3" flexWrap="wrap">
              <Button size="$3" icon={saved ? <Check size={15} /> : <Trophy size={15} />} onPress={save} disabled={busy}>
                {saved ? 'Saved' : busy ? 'Saving…' : 'Save handle'}
              </Button>
              <Text fontSize="$1" color="$color10">
                Only your handle + aggregate earnings are ever shown — never your organization.
              </Text>
            </XStack>
          </YStack>
        </YStack>
      )}
    </PanelCard>
  )
}
