'use client'

/**
 * Treasury (admin) — the GLOBAL-ADMIN operator board over cloud-api's
 * `GET /v1/admin/treasury` + the `policy`/`sweep`/`seed`/`anchor` mutations (cloud
 * `clients/treasury`). The platform RESERVE FUND: a revenue-share of platform spend
 * accrues in, the growth-loop programs (referral / affiliate / author) are BACKED
 * out of it, and every movement is a double-entry journal line whose Merkle root is
 * anchored on the Hanzo L1. Reads/writes terminate at the global-admin-gated
 * `app/admin/aggregate` proxy (server 403 for a non-admin); the UI adds honest
 * states, never a fabricated ledger and never a faked "anchored" state. `admin: true`
 * hides the entry from customers.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  Anchor,
  ArrowDownCircle,
  CheckCircle2,
  Coins,
  HandCoins,
  Landmark,
  Percent,
  PiggyBank,
  RefreshCw,
  TriangleAlert,
} from '@hanzogui/lucide-icons-2'

import { AdminTreasuryApi, type AnchorStatus, type JournalEntry, type TreasuryView } from '~/lib/api/admin-treasury'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { FieldText } from '~/components/ui/Field'
import { asApiError, ErrorState, isForbidden, SuperAdminRequired } from '~/components/ui/States'
import { ApiError } from '~/lib/api'
import { toneColor } from '~/components/ui/tone'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; data: T }

// ── money / time formatting (honest, never NaN) ──────────────────────────────

/** USD cents → "$10.00" (em-dash for a non-finite value). */
const usd = (cents: number | null | undefined): string => {
  if (cents == null || !Number.isFinite(cents)) return '—'
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Signed USD cents → "+$10.00" / "-$10.00" (for a journal posting leg). */
const signedUsd = (cents: number): string => (cents < 0 ? `-${usd(-cents)}` : `+${usd(cents)}`)

/** Basis points → a human percent ("2000" → "20%", "1550" → "15.5%"). */
const pctFromBps = (bps: number): string => {
  if (!Number.isFinite(bps)) return '—'
  const pct = bps / 100
  return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(2)}%`
}

/** A typed percent → integer basis points, or null when blank/invalid. */
const bpsFromPct = (input: string): number | null => {
  const t = (input ?? '').trim().replace(/%$/, '')
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/** Dollars typed in a form → integer cents, or null when blank/invalid (>0). */
const dollarsToCents = (input: string): number | null => {
  const t = (input ?? '').trim().replace(/^\$/, '')
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

/** Unix seconds OR ms → a short local date-time; em-dash when unset (0). */
const shortTime = (n: number): string => {
  if (!n) return '—'
  try {
    const ms = n > 1e12 ? n : n * 1000
    return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

/** Truncate a 0x… root/hash to head…tail. */
const truncHex = (hex: string): string => {
  if (!hex) return '—'
  return hex.length > 18 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex
}

export function TreasuryAdminModule() {
  const [state, setState] = useState<Async<TreasuryView>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    AdminTreasuryApi.get()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  return (
    <YStack gap="$4">
      <PageHeader
        title="Treasury"
        subtitle="Platform reserve fund — revenue-share policy, backed growth-loop payouts, double-entry journal, and the Hanzo L1 anchor. Global-admin only."
        actions={
          <Button size="$3" icon={<RefreshCw size={15} />} onPress={load} disabled={state.phase === 'loading'}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' ? (
        <XStack p="$6" justify="center">
          <Text color="$color11">Loading treasury…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <SuperAdminRequired />
        ) : (
          <ErrorState
            err={state.err}
            onRetry={load}
            copy={{ notFound: 'The treasury aggregate is not routed on this deployment yet (GET /v1/admin/treasury).' }}
          />
        )
      ) : (
        <TreasuryReady data={state.data} onChanged={load} />
      )}
    </YStack>
  )
}

function TreasuryReady({ data, onChanged }: { data: TreasuryView; onChanged: () => void }) {
  const { report, journal, anchor } = data
  const solvent = report.solventForPayout
  return (
    <YStack gap="$4">
      {/* KPI row + solvency pill */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Landmark size={16} color={toneColor('positive')} />} label="Reserve" value={usd(report.reserveCents)} caption="available balance" />
        <MetricCard icon={<Coins size={16} color="$color11" />} label="Accrued" value={usd(report.accruedCents)} caption="lifetime revenue-share in" />
        <MetricCard icon={<HandCoins size={16} color={toneColor('warning')} />} label="Paid out" value={usd(report.paidCents)} caption="lifetime backed payouts" />
        <MetricCard icon={<Percent size={16} color={toneColor('neutral')} />} label="Revenue-share" value={pctFromBps(report.policy.revenueShareBps)} caption="of platform spend" />
      </XStack>

      <XStack items="center" gap="$2">
        <SolvencyPill solvent={solvent} />
        <Text fontSize="$2" color="$color10">
          {solvent
            ? 'The reserve fund can back the next payout.'
            : 'The reserve fund is empty — seed it or run a sweep before backing a payout.'}
        </Text>
      </XStack>

      <PolicyForm currentBps={report.policy.revenueShareBps} updatedAt={report.policy.updatedAt} onChanged={onChanged} />

      <XStack gap="$4" flexWrap="wrap">
        <SweepForm onChanged={onChanged} />
        <SeedForm onChanged={onChanged} />
      </XStack>

      <ByProgramPanel referral={report.byProgramCents.referral} affiliate={report.byProgramCents.affiliate} author={report.byProgramCents.author} />

      <JournalPanel journal={journal} />

      <AnchorPanel anchor={anchor} onChanged={onChanged} />
    </YStack>
  )
}

function SolvencyPill({ solvent }: { solvent: boolean }) {
  return (
    <XStack
      items="center"
      gap="$1.5"
      px="$2.5"
      py="$1"
      rounded="$10"
      borderWidth={1}
      borderColor={toneColor(solvent ? 'positive' : 'warning')}
    >
      {solvent ? <CheckCircle2 size={13} color={toneColor('positive')} /> : <TriangleAlert size={13} color={toneColor('warning')} />}
      <Text fontSize="$2" fontWeight="700" color={toneColor(solvent ? 'positive' : 'warning')}>
        {solvent ? 'Solvent' : 'Fund empty'}
      </Text>
    </XStack>
  )
}

// ── revenue-share policy ─────────────────────────────────────────────────────

function PolicyForm({ currentBps, updatedAt, onChanged }: { currentBps: number; updatedAt: number; onChanged: () => void }) {
  const [pct, setPct] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = useCallback(() => {
    const bps = bpsFromPct(pct)
    if (bps == null) {
      setErr('Enter a non-negative percent (e.g. 20 for 20%).')
      return
    }
    setBusy(true)
    setErr(null)
    AdminTreasuryApi.setPolicy(bps)
      .then(() => {
        setPct('')
        onChanged()
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not update policy'))
      .finally(() => setBusy(false))
  }, [pct, onChanged])

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$2">
        <Percent size={16} color={toneColor('neutral')} />
        <Text fontSize="$4" fontWeight="700">
          Revenue-share policy
        </Text>
      </XStack>
      <Text fontSize="$2" color="$color11">
        Currently <Text fontWeight="700">{pctFromBps(currentBps)}</Text> of platform spend is swept into the reserve fund
        {updatedAt ? ` · updated ${shortTime(updatedAt)}` : ''}.
      </Text>
      <XStack gap="$2" items="flex-end" flexWrap="wrap">
        <YStack flex={1} minW={160} gap="$1">
          <Text fontSize="$2" color="$color11">
            New share (%)
          </Text>
          <FieldText value={pct} onChange={setPct} disabled={busy} placeholder="e.g. 20" />
        </YStack>
        <PrimaryButton size="$3" onPress={save} disabled={busy}>
          {busy ? 'Saving…' : 'Update policy'}
        </PrimaryButton>
      </XStack>
      {err ? (
        <Text fontSize="$2" color={toneColor('critical')}>
          {err}
        </Text>
      ) : null}
    </Card>
  )
}

// ── sweep + seed actions ─────────────────────────────────────────────────────

function SweepForm({ onChanged }: { onChanged: () => void }) {
  const [revenue, setRevenue] = useState('')
  const [period, setPeriod] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const run = useCallback(() => {
    const cents = dollarsToCents(revenue)
    if (cents == null) {
      setErr('Enter a positive revenue amount to sweep.')
      return
    }
    setBusy(true)
    setErr(null)
    AdminTreasuryApi.sweep(cents, period)
      .then((r) => {
        setNote(`Swept ${usd(r.revenueCents)} for ${r.period || 'this period'} · accrued ${usd(r.accruedCents)} into the fund.`)
        setRevenue('')
        setPeriod('')
        onChanged()
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Sweep failed'))
      .finally(() => setBusy(false))
  }, [revenue, period, onChanged])

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={280}>
      <XStack items="center" gap="$2">
        <ArrowDownCircle size={16} color="$color11" />
        <Text fontSize="$4" fontWeight="700">
          Sweep revenue-share
        </Text>
      </XStack>
      <Text fontSize="$1" color="$color10">
        Accrue the revenue-share on a period&apos;s platform revenue into the reserve fund.
      </Text>
      <YStack gap="$1">
        <Text fontSize="$2" color="$color11">
          Platform revenue (USD)
        </Text>
        <FieldText value={revenue} onChange={setRevenue} disabled={busy} placeholder="e.g. 25000.00" />
      </YStack>
      <YStack gap="$1">
        <Text fontSize="$2" color="$color11">
          Period (YYYY-MM, blank = current month)
        </Text>
        <FieldText value={period} onChange={setPeriod} disabled={busy} placeholder="e.g. 2026-07" />
      </YStack>
      <XStack>
        <PrimaryButton size="$3" onPress={run} disabled={busy}>
          {busy ? 'Sweeping…' : 'Run sweep'}
        </PrimaryButton>
      </XStack>
      {note ? (
        <Text fontSize="$2" color="$color11">
          {note}
        </Text>
      ) : null}
      {err ? (
        <Text fontSize="$2" color={toneColor('critical')}>
          {err}
        </Text>
      ) : null}
    </Card>
  )
}

function SeedForm({ onChanged }: { onChanged: () => void }) {
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const run = useCallback(() => {
    const cents = dollarsToCents(amount)
    if (cents == null) {
      setErr('Enter a positive dollar amount to seed.')
      return
    }
    setBusy(true)
    setErr(null)
    AdminTreasuryApi.seed(cents, memo.trim())
      .then((r) => {
        setNote(`Seeded ${usd(cents)} · reserve now ${usd(r.reserveCents)}.`)
        setAmount('')
        setMemo('')
        onChanged()
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Seed failed'))
      .finally(() => setBusy(false))
  }, [amount, memo, onChanged])

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={280}>
      <XStack items="center" gap="$2">
        <PiggyBank size={16} color={toneColor('positive')} />
        <Text fontSize="$4" fontWeight="700">
          Seed reserve
        </Text>
      </XStack>
      <Text fontSize="$1" color="$color10">
        Add funds directly to the reserve — a seed journal entry (e.g. an initial capitalization).
      </Text>
      <YStack gap="$1">
        <Text fontSize="$2" color="$color11">
          Amount (USD)
        </Text>
        <FieldText value={amount} onChange={setAmount} disabled={busy} placeholder="e.g. 10000.00" />
      </YStack>
      <YStack gap="$1">
        <Text fontSize="$2" color="$color11">
          Memo (optional)
        </Text>
        <FieldText value={memo} onChange={setMemo} disabled={busy} placeholder="e.g. Q3 capitalization" />
      </YStack>
      <XStack>
        <PrimaryButton size="$3" onPress={run} disabled={busy}>
          {busy ? 'Seeding…' : 'Seed reserve'}
        </PrimaryButton>
      </XStack>
      {note ? (
        <Text fontSize="$2" color="$color11">
          {note}
        </Text>
      ) : null}
      {err ? (
        <Text fontSize="$2" color={toneColor('critical')}>
          {err}
        </Text>
      ) : null}
    </Card>
  )
}

// ── payouts by program ───────────────────────────────────────────────────────

type ProgramRow = { program: string; label: string; cents: number }

function ByProgramPanel({ referral, affiliate, author }: { referral: number; affiliate: number; author: number }) {
  const rows: ProgramRow[] = [
    { program: 'referral', label: 'Referral', cents: referral },
    { program: 'affiliate', label: 'Affiliate', cents: affiliate },
    { program: 'author', label: 'Author', cents: author },
  ]
  const cols: Column<ProgramRow>[] = [
    { key: 'label', header: 'Program', render: (r) => <Text fontSize="$3" color="$color12">{r.label}</Text> },
    { key: 'cents', header: 'Backed payouts', align: 'right', mono: true, render: (r) => <Text fontSize="$2" color="$color11">{r.cents ? usd(r.cents) : '$0.00'}</Text> },
  ]
  return (
    <YStack gap="$2">
      <Text fontSize="$5" color="$color12">
        Payouts by program
      </Text>
      <Text fontSize="$1" color="$color10">
        Lifetime cash backed out of the reserve fund to each growth-loop program.
      </Text>
      <DataTable<ProgramRow> columns={cols} rows={rows} rowKey={(r) => r.program} empty="No program payouts yet." />
    </YStack>
  )
}

// ── double-entry journal ─────────────────────────────────────────────────────

function kindTone(kind: string) {
  switch (kind) {
    case 'accrual':
      return toneColor('neutral')
    case 'payout':
      return toneColor('warning')
    case 'seed':
      return toneColor('positive')
    default:
      return toneColor('muted')
  }
}

function JournalPanel({ journal }: { journal: JournalEntry[] }) {
  const cols: Column<JournalEntry>[] = [
    { key: 'createdAt', header: 'Date', width: 132, render: (e) => <Text fontSize="$2" color="$color11">{shortTime(e.createdAt)}</Text> },
    { key: 'kind', header: 'Kind', width: 96, render: (e) => <Text fontSize="$2" fontWeight="700" color={kindTone(e.kind)}>{e.kind || '—'}</Text> },
    { key: 'program', header: 'Program', width: 96, render: (e) => <Text fontSize="$2" color="$color11">{e.program || '—'}</Text> },
    { key: 'memo', header: 'Memo', render: (e) => (
        <YStack gap="$0.5">
          <Text fontSize="$3" color="$color12" numberOfLines={1}>{e.memo || '—'}</Text>
          {e.postings.length ? (
            <Text fontSize="$1" color="$color9" numberOfLines={1} className="mono">
              {e.postings.map((p) => `${p.account} ${signedUsd(p.amount)}`).join(' · ')}
            </Text>
          ) : null}
        </YStack>
      ) },
    { key: 'amountCents', header: 'Amount', align: 'right', mono: true, render: (e) => <Text fontSize="$2" color="$color12">{usd(e.amountCents)}</Text> },
  ]
  if (journal.length === 0) {
    return (
      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">
          Journal
        </Text>
        <EmptyState
          icon={Coins}
          title="No journal entries yet"
          description="Double-entry lines appear here as the fund accrues revenue-share, backs payouts, and is seeded."
          bullets={[
            'Source: GET /v1/admin/treasury — the cloud treasury store, global-admin only.',
            'Run a sweep to accrue this period, or seed the reserve to record an opening balance.',
          ]}
        />
      </YStack>
    )
  }
  return (
    <YStack gap="$2">
      <Text fontSize="$5" color="$color12">
        Journal
      </Text>
      <Text fontSize="$1" color="$color10">
        Recent double-entry lines, newest first — each entry&apos;s postings net to zero.
      </Text>
      <DataTable<JournalEntry> columns={cols} rows={journal} rowKey={(e) => e.id} empty="No journal entries yet." />
    </YStack>
  )
}

// ── Hanzo L1 anchor ──────────────────────────────────────────────────────────

function anchorTone(status: string) {
  if (status === 'anchored') return toneColor('positive')
  if (status === 'error') return toneColor('critical')
  return toneColor('warning')
}

function AnchorPanel({ anchor, onChanged }: { anchor: AnchorStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const configured = anchor.rpcConfigured && anchor.signerConfigured
  const tone = anchorTone(anchor.status)

  const run = useCallback(() => {
    setBusy(true)
    setErr(null)
    AdminTreasuryApi.anchor()
      .then(() => onChanged())
      .catch((e) => setErr(e instanceof Error ? e.message : 'Anchor failed'))
      .finally(() => setBusy(false))
  }, [onChanged])

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <XStack items="center" gap="$2">
          <Anchor size={16} color={toneColor('neutral')} />
          <Text fontSize="$4" fontWeight="700">
            Hanzo L1 anchor
          </Text>
          <XStack items="center" gap="$1.5" px="$2" py="$0.5" rounded="$10" borderWidth={1} borderColor={tone}>
            <Text fontSize="$1" fontWeight="700" color={tone}>
              {anchor.status || 'pending'}
            </Text>
          </XStack>
          {anchor.currentRoot ? (
            <XStack items="center" gap="$1.5" px="$2" py="$0.5" rounded="$10" borderWidth={1} borderColor={toneColor(anchor.synced ? 'positive' : 'warning')}>
              <Text fontSize="$1" fontWeight="700" color={toneColor(anchor.synced ? 'positive' : 'warning')}>
                {anchor.synced ? 'Synced' : 'Stale'}
              </Text>
            </XStack>
          ) : null}
        </XStack>
        <Button
          size="$3"
          icon={<Anchor size={15} />}
          onPress={configured ? run : undefined}
          disabled={busy || !configured}
        >
          {busy ? 'Anchoring…' : 'Anchor now'}
        </Button>
      </XStack>

      <XStack gap="$4" flexWrap="wrap">
        <Fact label="Chain ID" value={anchor.chainId ? String(anchor.chainId) : '—'} />
        <Fact label="Entries" value={String(anchor.entryCount)} />
        <Fact label="Current root" value={truncHex(anchor.currentRoot)} mono />
        <Fact label="Contract" value={anchor.contract ? truncHex(anchor.contract) : '—'} mono />
      </XStack>

      <XStack gap="$4" flexWrap="wrap">
        <Fact label="Last anchored" value={shortTime(anchor.lastAt)} />
        <Fact label="Last block" value={anchor.lastBlock ? String(anchor.lastBlock) : '—'} />
        <Fact label="Last root" value={anchor.lastRoot ? truncHex(anchor.lastRoot) : '—'} mono />
        <Fact label="Last tx" value={anchor.lastTxHash ? truncHex(anchor.lastTxHash) : '—'} mono />
      </XStack>

      {!configured ? (
        <Text fontSize="$2" color="$color10">
          {anchor.note || 'Chain wiring is pending — the anchor RPC and/or signer are not configured on this deployment.'}
        </Text>
      ) : anchor.note ? (
        <Text fontSize="$2" color="$color10">
          {anchor.note}
        </Text>
      ) : null}
      {err ? (
        <Text fontSize="$2" color={toneColor('critical')}>
          {err}
        </Text>
      ) : null}
    </Card>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <YStack gap="$0.5" minW={140}>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" className={mono ? 'mono' : undefined}>
        {value}
      </Text>
    </YStack>
  )
}
