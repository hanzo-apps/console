'use client'

/**
 * Per-product Logs — the REAL platform log stream for THIS product's operator
 * service, via the same-origin `/paas` proxy (`GET /v1/logs?service=<svc>`), the
 * same source the global Logs board reads, scoped to one service. The proxy
 * injects the service token server-side; the rows are additionally filtered
 * client-side to the product's service so a backend that ignores the query param
 * can never leak another service's lines onto this page.
 *
 * Honest states, never a blank/broken grid:
 *  - product with no discrete service → an honest "no product log source" card;
 *  - proxy 403 (customer) / 501 (token unset) / 404 (not wired) → the shared
 *    platform state card ("Connected · managed by Hanzo" / not configured / not
 *    available), never a scary error;
 *  - reachable + empty → an honest "no logs yet" empty state.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { CheckCircle2, FileText, RefreshCw } from '@hanzogui/lucide-icons-2'

import type { CatalogEntry } from '~/lib/products/registry'
import { restGet } from '~/lib/api/client'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from '../platform/state'
import { subpageSourcesFor } from './sources'

const enc = encodeURIComponent
const paas = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

type LogEntry = {
  id: string
  timestamp?: string
  level?: string
  service?: string
  message?: string
}

export function ProductLogsView({ entry }: { entry: CatalogEntry }) {
  const { service } = subpageSourcesFor(entry)
  const [rows, setRows] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    if (!service) {
      setRows([])
      setLoading(false)
      setLoadError(null)
      return
    }
    setLoading(true)
    try {
      const r = await restGet<{ logs?: LogEntry[] }>(paas(`logs?service=${enc(service)}`))
      // Belt-and-suspenders: filter to the product's service in case the backend
      // ignores the query param (never show another service's lines here).
      const all = r.logs ?? []
      const mine = all.filter((l) => !l.service || l.service === service)
      setRows(mine)
      setLoadError(null)
    } catch (e) {
      setLoadError(interpretPlatformError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<LogEntry>[] = [
    {
      key: 'timestamp',
      header: 'Time',
      width: 190,
      render: (l) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {l.timestamp ? new Date(l.timestamp).toLocaleString() : '—'}
        </Text>
      ),
    },
    { key: 'level', header: 'Level', width: 90, render: (l) => <Text fontSize="$3" color="$color11">{l.level || '—'}</Text> },
    {
      key: 'message',
      header: 'Message',
      render: (l) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {l.message || '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={`${entry.label} · Logs`}
        subtitle={`Structured logs for the ${entry.label} service.`}
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {!service ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
          <XStack gap="$2" items="center">
            <FileText size={16} color="$color10" />
            <Text fontSize="$4" fontWeight="700">No product log source</Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            {entry.label} is a managed capability with no discrete service log stream. Logs appear here
            automatically if it ever runs as its own service — nothing is fabricated.
          </Text>
        </Card>
      ) : loadError && loadError.kind === 'forbidden' ? (
        // Reached the control plane, but the log stream is managed/admin-scoped on this
        // deployment — a Logs-specific honest state, never a scary error and never fake lines.
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
          <XStack gap="$2" items="center">
            <CheckCircle2 size={16} color="$green10" />
            <Text fontSize="$4" fontWeight="700">Logs · managed by Hanzo</Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            {entry.label} runs on managed Hanzo Cloud. Its log stream is handled by the control plane and
            isn&apos;t routed to the console on this deployment — no fabricated lines are shown. If {entry.label}{' '}
            ever streams logs to the console, they appear here automatically.
          </Text>
        </Card>
      ) : loadError ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.id}
          empty={`No logs for ${entry.label} yet.`}
        />
      )}
    </>
  )
}
