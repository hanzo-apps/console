'use client'

/**
 * Alerts — alert rules (conditions, severities, current state) evaluated by the
 * platform observability engine.
 *
 * Reads the REAL alert rules from Hanzo o11y through the same-origin user-bearer
 * `/v1` bearer proxy: `GET /v1/o11y/rules` (the version-less canonical o11y surface;
 * cloud serves the embedded o11y `rules` → `ListRuleStates`). The o11y envelope is
 * `{status,data:{rules:[…]}}` where each rule is a flattened `GettableRule`
 * (`alert`, `state`, `labels.severity`, `description`, …) — normalized here to the
 * console's flat Alert row. When o11y isn't reachable / authorized the load fails and
 * the honest not-configured / unavailable card renders instead of an empty grid —
 * matching every other infra module. Nothing is fabricated.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet, cloudProxyV1Url } from '~/lib/api/client'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

type Alert = {
  id: string
  name?: string
  severity?: string
  status?: string
  condition?: string
  lastFired?: string
}

/** One rule as o11y's `GettableRule` serializes it (PostableRule fields flattened). */
type O11yRule = {
  id?: string
  /** Evaluated state: inactive | pending | recovering | firing | nodata | disabled. */
  state?: string
  /** Alert name (`PostableRule.alert`). */
  alert?: string
  description?: string
  ruleType?: string
  disabled?: boolean
  labels?: Record<string, string>
}

/** o11y wraps every read as `{status:"success", data:…}`. */
type O11yRulesResponse = { status?: string; data?: { rules?: O11yRule[] } }

/**
 * Flatten one o11y rule to the console Alert row. Honest mapping only:
 *  - `status` is the real evaluated `state` (or `disabled` when the rule is off);
 *  - `condition` is the rule's own `description` (o11y's `condition` field is a
 *    composite query object, not a display string — we never stringify it into a
 *    fake human condition);
 *  - `lastFired` is left empty: the rule-list endpoint carries no last-fired
 *    timestamp (that lives in the per-rule history timeline), so we show "—" rather
 *    than mislabel `updateAt` (rule edit time) as a firing time.
 */
const toAlert = (r: O11yRule): Alert => ({
  id: r.id || r.alert || '',
  name: r.alert,
  severity: r.labels?.severity,
  status: r.disabled ? 'disabled' : r.state,
  condition: r.description,
})

export function AlertsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<O11yRulesResponse>(cloudProxyV1Url('o11y/rules'))
      setRows((r?.data?.rules ?? []).map(toAlert))
      setLoadError(null)
    } catch (e) {
      setLoadError(interpretPlatformError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<Alert>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (a) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {a.name || a.id}
        </Text>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      width: 110,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.severity || '—'}
        </Text>
      ),
    },
    {
      key: 'condition',
      header: 'Condition',
      width: 220,
      render: (a) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {a.condition || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (a) => <StatusTag status={a.status ?? 'unknown'} />,
    },
    {
      key: 'lastFired',
      header: 'Last fired',
      width: 190,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.lastFired ? new Date(a.lastFired).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Alert rules — conditions, severities, recent firings."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loadError ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(a) => a.id}
          empty="No alert rules yet."
        />
      )}
    </>
  )
}
