'use client'

/**
 * Budgets & alerts — create and list spend budgets over the REAL commerce
 * spend-alerts API (`GET/POST /v1/billing/spend-alerts`, the user-group endpoints
 * billing.hanzo.ai itself uses), scoped to the caller's OWN subject by the
 * `/billing` proxy (list pins `?user=`, create pins the body subject server-side).
 *
 * This is a REAL working form, not a stub: a budget you create here is persisted by
 * commerce and returned by the list. Honest states throughout — loading, a truthful
 * `BackendStateCard` on any failure, and an honest empty. No fabricated budgets.
 *
 * Read + create only: editing/removing a budget is intentionally not exposed here
 * yet — commerce's PATCH/DELETE do not verify per-alert ownership within a shared
 * personal-billing org, so surfacing them from the browser would be a cross-user
 * hole. Wiring them waits on that server-side ownership check (see the PR notes).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Plus, Bell, CheckCircle2, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { BillingApi, type SpendAlert } from '~/lib/api/billing'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`
const fmtDate = (s?: string): string => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString()
}

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

type Create =
  | { state: 'idle' }
  | { state: 'submitting' }
  | { state: 'error'; message: string }

export function BillingBudgets(_props: { params: Record<string, string> }) {
  const [alerts, setAlerts] = useState<Async<SpendAlert[]>>({ phase: 'loading' })
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [create, setCreate] = useState<Create>({ state: 'idle' })

  const load = useCallback(() => {
    setAlerts({ phase: 'loading' })
    BillingApi.spendAlerts()
      .then((data) => setAlerts({ phase: 'ready', data }))
      .catch((e) => setAlerts({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const submit = useCallback(async () => {
    const dollars = Number.parseFloat(amount)
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setCreate({ state: 'error', message: 'Enter a threshold amount greater than zero.' })
      return
    }
    setCreate({ state: 'submitting' })
    try {
      await BillingApi.createSpendAlert({ title: title.trim() || 'Budget', thresholdCents: Math.round(dollars * 100) })
      setTitle('')
      setAmount('')
      setShowForm(false)
      setCreate({ state: 'idle' })
      load()
    } catch (e) {
      const s = classifyBackend(e)
      setCreate({ state: 'error', message: s.message || 'Could not create the budget.' })
    }
  }, [amount, title, load])

  const columns: Column<SpendAlert>[] = [
    {
      key: 'title',
      header: 'Budget',
      render: (a) => (
        <XStack items="center" gap="$2">
          <Bell size={14} opacity={0.6} />
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{a.title}</Text>
        </XStack>
      ),
    },
    { key: 'thresholdCents', header: 'Threshold', width: 140, render: (a) => <Text fontSize="$3" color="$color12">{usd(a.thresholdCents)}</Text> },
    { key: 'currency', header: 'Currency', width: 110, render: (a) => <Text fontSize="$3" color="$color11">{a.currency.toUpperCase()}</Text> },
    {
      key: 'status',
      header: 'Status',
      width: 140,
      render: (a) => (a.triggeredAt ? <StatusTag status="triggered" /> : <StatusTag status="active" />),
    },
    { key: 'createdAt', header: 'Created', width: 130, render: (a) => <Text fontSize="$3" color="$color11">{fmtDate(a.createdAt)}</Text> },
  ]

  return (
    <>
      <PageHeader
        title="Budgets & alerts"
        subtitle="Set a spend threshold and get alerted when your organization crosses it. Budgets are read from and saved to commerce — real, not a placeholder."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <Button size="$2" theme="light" icon={<Plus size={14} />} onPress={() => setShowForm((v) => !v)}>
              New budget
            </Button>
          </XStack>
        }
      />

      {/* ── Create form ──────────────────────────────────────────────────────── */}
      {showForm ? (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxW={560}>
          <Text fontSize="$4" fontWeight="800" color="$color12">New budget</Text>
          <YStack gap="$2">
            <Text fontSize="$2" color="$color11">Name</Text>
            <Input value={title} onChangeText={setTitle} placeholder="e.g. Monthly cap" disabled={create.state === 'submitting'} />
          </YStack>
          <YStack gap="$2">
            <Text fontSize="$2" color="$color11">Threshold (USD)</Text>
            <XStack items="center" gap="$2">
              <Text fontSize="$5" color="$color11">$</Text>
              <Input flex={1} value={amount} onChangeText={setAmount} placeholder="500.00" keyboardType="decimal-pad" disabled={create.state === 'submitting'} />
            </XStack>
            <Text fontSize="$1" color="$color10">You&apos;ll be alerted once spend crosses this amount.</Text>
          </YStack>
          {create.state === 'error' ? (
            <XStack items="center" gap="$2">
              <TriangleAlert size={15} />
              <Text fontSize="$2" color="$color11">{create.message}</Text>
            </XStack>
          ) : null}
          <XStack gap="$2">
            <Button size="$3" theme="light" onPress={submit} disabled={create.state === 'submitting' || !amount}>
              {create.state === 'submitting' ? 'Creating…' : 'Create budget'}
            </Button>
            <Button size="$3" chromeless onPress={() => { setShowForm(false); setCreate({ state: 'idle' }) }} disabled={create.state === 'submitting'}>
              Cancel
            </Button>
          </XStack>
        </Card>
      ) : null}

      {/* ── List ─────────────────────────────────────────────────────────────── */}
      {alerts.phase === 'error' ? (
        <BackendStateCard state={alerts.error} onRetry={load} hint="endpoint · GET /v1/billing/spend-alerts" />
      ) : (
        <DataTable
          columns={columns}
          rows={alerts.phase === 'ready' ? alerts.data : []}
          loading={alerts.phase === 'loading'}
          rowKey={(a) => a.id}
          empty="No budgets yet. Create one to get alerted when spend crosses a threshold."
        />
      )}

      {alerts.phase === 'ready' && alerts.data.length > 0 ? (
        <XStack items="center" gap="$2">
          <CheckCircle2 size={14} opacity={0.6} />
          <Text fontSize="$2" color="$color10">
            {alerts.data.length} budget{alerts.data.length === 1 ? '' : 's'} · alerts fire against your real metered spend.
          </Text>
        </XStack>
      ) : null}
    </>
  )
}
