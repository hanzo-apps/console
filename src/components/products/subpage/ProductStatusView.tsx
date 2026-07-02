'use client'

/**
 * Per-product Status — the REAL health of THIS product's operator service, scoped
 * from the platform apps inventory (`PlatformApi.apps()`), the SAME source the
 * native overview health band and the global Status board read. One way to read
 * the platform; here it is filtered to the product's own service.
 *
 * Honest by construction, never a fabricated green:
 *  - admin, service reporting → the real per-env health verdict + a workloads table
 *    (env · cluster · running tag · health · drift) for THIS service only;
 *  - admin, service absent    → "not deployed in this org" (the control plane has no
 *    row for it), never a fake "operational";
 *  - customer (control plane is admin-scoped) → the shared "Connected · managed by
 *    Hanzo" state (green, no retry) — honest, not an error;
 *  - product with no discrete service → an honest managed-capability card.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { CheckCircle2, RefreshCw } from '@hanzogui/lucide-icons-2'

import type { CatalogEntry } from '~/lib/products/registry'
import { PlatformApi, type PlatformApp } from '~/lib/api/platform'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from '../platform/state'
import { subpageSourcesFor } from './sources'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: PlatformError }
  | { phase: 'ready'; rows: PlatformApp[] }

const isUp = (a: PlatformApp): boolean => a.health === 'green'

/** Roll the (possibly multi-env) rows for the service into one verdict. */
function verdict(apps: PlatformApp[]): { tone: 'green' | 'yellow' | 'red'; label: string } {
  if (apps.some((a) => a.health === 'red')) return { tone: 'red', label: 'Degraded' }
  if (apps.some((a) => a.health === 'yellow')) return { tone: 'yellow', label: 'Partial' }
  return { tone: 'green', label: 'Operational' }
}

const TONE_DOT = { green: '#3fb950', yellow: '#d29922', red: '#f85149' } as const

export function ProductStatusView({ entry }: { entry: CatalogEntry }) {
  const { service } = subpageSourcesFor(entry)
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(() => {
    if (!service) {
      setState({ phase: 'ready', rows: [] })
      return
    }
    setState({ phase: 'loading' })
    PlatformApi.apps()
      .then((all) => setState({ phase: 'ready', rows: all.filter((a) => a.app === service) }))
      .catch((e) => setState({ phase: 'error', error: interpretPlatformError(e) }))
  }, [service])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<PlatformApp>[] = [
    { key: 'env', header: 'Environment', width: 120, render: (r) => <Text fontSize="$3" fontWeight="600">{r.env}</Text> },
    { key: 'cluster', header: 'Cluster', render: (r) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{r.cluster}</Text> },
    { key: 'namespace', header: 'Namespace', width: 140, render: (r) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{r.namespace ?? '—'}</Text> },
    { key: 'runningTag', header: 'Running', width: 150, render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.runningTag ?? '—'}</Text> },
    { key: 'health', header: 'Health', width: 110, render: (r) => <StatusTag status={r.health} /> },
  ]

  return (
    <>
      <PageHeader
        title={`${entry.label} · Status`}
        subtitle={`Live health of the ${entry.label} service across your clusters.`}
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Probing {entry.label}…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        <PlatformStateCard error={state.error} onRetry={load} />
      ) : state.rows.length === 0 ? (
        <ManagedCard entry={entry} hasService={Boolean(service)} />
      ) : (
        <YStack gap="$3">
          {(() => {
            const v = verdict(state.rows)
            return (
              <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2.5" maxWidth={720}>
                <XStack items="center" gap="$2" flexWrap="wrap">
                  <YStack width={10} height={10} rounded="$10" style={{ backgroundColor: TONE_DOT[v.tone] }} />
                  <Text fontSize="$5" fontWeight="800" color="$color12">{v.label}</Text>
                  <Text fontSize="$2" color="$color10">
                    · {state.rows.filter(isUp).length}/{state.rows.length} healthy · {new Set(state.rows.map((r) => r.cluster)).size}{' '}
                    {new Set(state.rows.map((r) => r.cluster)).size === 1 ? 'cluster' : 'clusters'}
                  </Text>
                </XStack>
              </Card>
            )
          })()}
          <DataTable
            columns={columns}
            rows={state.rows}
            rowKey={(r) => r.id}
            empty={`No running ${entry.label} service reported for your organization.`}
          />
        </YStack>
      )}
    </>
  )
}

/** Honest managed-capability card — the product has no discrete service reporting to the control plane. */
function ManagedCard({ entry, hasService }: { entry: CatalogEntry; hasService: boolean }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
      <XStack gap="$2" items="center">
        <CheckCircle2 size={16} color="$green10" />
        <Text fontSize="$4" fontWeight="700">
          {hasService ? `${entry.label} not deployed in this org` : `${entry.label} · managed by Hanzo`}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {hasService
          ? `The control plane has no running ${entry.label} service for your organization yet. Provision it, then its live health and workloads appear here — nothing is fabricated.`
          : `${entry.label} is a managed Hanzo Cloud capability with no discrete service to report health for. It is available through the API; there is no fabricated status shown.`}
      </Text>
    </Card>
  )
}
