'use client'

/**
 * Ads — the ONE native ads surface, rendered IN-CONSOLE over cloud `/v1/ads/*`
 * (`hanzoai/cloud` clients/ads: a native-Go per-org ad-campaign store on
 * Base/SQLite, twin of clients/crm) through the `/v1` user-bearer proxy. NO
 * link-out, one surface.
 *
 * This is the console half of the new `/v1/ads` domain seam — the host→mode twin
 * of Billing: on ads.hanzo.ai (config.adsOnly) the console boots straight into
 * THIS product. It starts THIN by design: the per-org Campaign CRUD + a real
 * summary roll-up. The ad-set → ad legs of the hierarchy are follow-ups that hang
 * off this seam.
 *
 * Every read/write is org-scoped by the Bearer owner claim SERVER-SIDE, so a caller
 * only ever sees THEIR org's campaigns. States are honest: loading, a
 * BackendStateCard on a `/v1` failure, and a real empty state — never fabricated rows.
 */
import { useCallback, useEffect, useState } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'
import { Target, Plus, RefreshCw } from '@hanzogui/lucide-icons-2'

import { PLATFORMS, STATUSES, AdsApi, type Campaign, type Summary } from '~/lib/api/ads'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { FieldRow, FieldText, FieldSelect } from '@hanzo/ui/product'
import { PageHeader } from '@hanzo/ui/product'
import { PrimaryButton } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { SlideOver } from '@hanzo/ui/product'

/** cents (int64 minor units from the backend) → a $ label. */
function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Parse a user-typed dollar amount into integer cents (defensive; NaN → 0). */
function toCents(dollars: string): number {
  const n = Number(dollars.trim())
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

type Data = { summary: Summary; campaigns: Campaign[] }

const COLUMNS: Column<Campaign>[] = [
  { key: 'name', header: 'Campaign', render: (c) => c.name || '—' },
  { key: 'platform', header: 'Platform', render: (c) => c.platform || '—' },
  { key: 'status', header: 'Status', render: (c) => <StatusTag status={c.status} /> },
  { key: 'budget', header: 'Budget', align: 'right', mono: true, render: (c) => money(c.budget) },
  { key: 'spend', header: 'Spend', align: 'right', mono: true, render: (c) => money(c.spend) },
]

/** The per-org summary bar (real `/v1/ads/summary` counts). */
function SummaryBar({ summary }: { summary: Summary }) {
  const cells: { label: string; value: string | number }[] = [
    { label: 'Campaigns', value: summary.campaigns },
    { label: 'Active', value: summary.active },
    { label: 'Budget', value: money(summary.budget) },
    { label: 'Spend', value: money(summary.spend) },
  ]
  return (
    <XStack gap="$3" flexWrap="wrap">
      {cells.map((c) => (
        <YStack key={c.label} gap="$1" borderWidth={1} borderColor="$borderColor" rounded="$4" px="$4" py="$3" minW={140}>
          <Text fontSize="$1" color="$color10">
            {c.label}
          </Text>
          <Text fontSize="$6" fontWeight="500" className="hz-tnum">
            {c.value}
          </Text>
        </YStack>
      ))}
    </XStack>
  )
}

/** The create-campaign panel — real POST /v1/ads/campaigns. */
function CreatePanel({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [platform, setPlatform] = useState<string>('meta')
  const [status, setStatus] = useState<string>('draft')
  const [budget, setBudget] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await AdsApi.campaigns.create({
        name: name.trim(),
        objective: objective.trim(),
        platform,
        status,
        budget: toCents(budget),
      })
      onCreated()
    } catch (e) {
      setError(classifyBackend(e).message || 'Failed to create campaign.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <YStack gap="$3" p="$4">
      <FieldRow label="Name">
        <FieldText value={name} onChange={setName} placeholder="Spring Launch" disabled={saving} />
      </FieldRow>
      <FieldRow label="Objective">
        <FieldText value={objective} onChange={setObjective} placeholder="conversions" disabled={saving} />
      </FieldRow>
      <FieldRow label="Platform">
        <FieldSelect value={platform} options={[...PLATFORMS]} onChange={setPlatform} disabled={saving} />
      </FieldRow>
      <FieldRow label="Status">
        <FieldSelect value={status} options={[...STATUSES]} onChange={setStatus} disabled={saving} />
      </FieldRow>
      <FieldRow label="Budget ($)">
        <FieldText value={budget} onChange={setBudget} placeholder="500.00" disabled={saving} />
      </FieldRow>
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error}
        </Text>
      ) : null}
      <PrimaryButton onPress={submit} disabled={saving}>
        {saving ? 'Creating…' : 'Create campaign'}
      </PrimaryButton>
    </YStack>
  )
}

export function AdsModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<Async<Data>>({ phase: 'loading' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const [summary, campaigns] = await Promise.all([
        AdsApi.summary(),
        AdsApi.campaigns.list(),
      ])
      setState({ phase: 'ready', data: { summary, campaigns } })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onCreated = () => {
    setCreating(false)
    void load()
  }

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="Ads"
        subtitle="Ad campaigns across platforms — per org, over the native /v1/ads engine."
        actions={
          <>
            <PrimaryButton onPress={() => setCreating(true)} icon={<Plus size={16} />}>
              New campaign
            </PrimaryButton>
            <PrimaryButton onPress={() => void load()} icon={<RefreshCw size={16} />}>
              Refresh
            </PrimaryButton>
          </>
        }
      />

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={() => void load()} />
      ) : state.phase === 'ready' && state.data.campaigns.length === 0 ? (
        <YStack gap="$4">
          <SummaryBar summary={state.data.summary} />
          <EmptyState
            icon={Target}
            title="No campaigns yet"
            description="Create your first ad campaign to start reaching customers across Meta, Google, TikTok, and X."
            primary={{ label: 'New campaign', onPress: () => setCreating(true) }}
          />
        </YStack>
      ) : (
        <YStack gap="$4">
          {state.phase === 'ready' ? <SummaryBar summary={state.data.summary} /> : null}
          <DataTable<Campaign>
            columns={COLUMNS}
            rows={state.phase === 'ready' ? state.data.campaigns : []}
            loading={state.phase === 'loading'}
            empty="No campaigns yet."
            rowKey={(c) => c.id}
          />
        </YStack>
      )}

      <SlideOver open={creating} onClose={() => setCreating(false)} title="New campaign" icon={Target} ariaLabel="New campaign">
        <CreatePanel onCreated={onCreated} />
      </SlideOver>
    </YStack>
  )
}
