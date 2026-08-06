'use client'

/**
 * Per-product Status — what "up" means here, and why you can defend it.
 *
 * Three orthogonal reads, each answering a different question, none of them fabricated:
 *
 *  1. IS IT UP — `O11yStatusApi.product` (`GET /v1/o11y/status?product=`). The backend
 *     tries a live HTTP probe against the service's fleet-registry URL (2s timeout); if
 *     that fails it falls back to the `hanzo_service_up` gauge (`event.metric` JOIN
 *     `event.series`). The response says WHICH signal answered via `source`, and this view
 *     shows that provenance rather than a bare green dot — a probe verdict and a gauge
 *     verdict are not the same claim.
 *
 *  2. IS IT HEALTHY — `O11yMetricsApi.service` (`GET /v1/o11y/product/metrics`). RED metrics
 *     over the window (requests, error rate, p95) derived from `event.span`, org-scoped by
 *     the minted bearer, so it works for a customer. The error-rate verdict uses the ONE
 *     shared `errorRateTone` threshold, so Status and Metrics can never disagree.
 *
 *  3. WHERE IS IT DEPLOYED — `PlatformApi.apps()`, the control-plane inventory, filtered to
 *     this product's operator service. Admin-scoped: a customer 403 simply omits the table.
 *
 * THE RULE, so a green dot is never decorative:
 *   probe succeeded            → Operational, provenance "live probe", latency shown
 *   gauge reports up           → Operational, provenance "hanzo_service_up", NO latency
 *   neither answered           → Not reachable
 *   no backing workload        → "nothing to report" — NOT a red dot, because an absent
 *                                service is not a failing one
 * Error rate refines the wording (Operational → Elevated errors → Degraded) but never
 * invents an up/down verdict of its own.
 *
 * Two traps the client encodes so this view cannot get them wrong: `probeLatencyMs` is null
 * unless a probe actually succeeded (the wire sends 0 for every failure — printing it would
 * claim "0ms" for a dead service), and `deployments` is at most one row per Service address,
 * never a replica list.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, CheckCircle2, RefreshCw } from '@hanzogui/lucide-icons-2'

import type { CatalogEntry } from '~/lib/products/registry'
import { PlatformApi, type PlatformApp } from '~/lib/api/platform'
import { O11yStatusApi, type ProductStatus } from '~/lib/api/o11y-status'
import { O11yMetricsApi, errorRateTone, type ServiceMetrics } from '~/lib/api/o11y-metrics'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from '../platform/state'
import { subpageSourcesFor } from './sources'
import { toneVar } from '~/components/ui/tone'

type DeployState =
  | { phase: 'loading' }
  | { phase: 'error'; error: PlatformError }
  | { phase: 'ready'; rows: PlatformApp[] }

/** The o11y half: the up-verdict and the RED window, resolved together. */
type O11yState =
  | { phase: 'loading' }
  | { phase: 'ready'; status: ProductStatus | null; red: ServiceMetrics | null }

const isUp = (a: PlatformApp): boolean => a.health === 'green'

/** Roll the (possibly multi-env) deployment rows into one verdict. */
function verdict(apps: PlatformApp[]): { tone: 'green' | 'yellow' | 'red'; label: string } {
  if (apps.some((a) => a.health === 'red')) return { tone: 'red', label: 'Degraded' }
  if (apps.some((a) => a.health === 'yellow')) return { tone: 'yellow', label: 'Partial' }
  return { tone: 'green', label: 'Operational' }
}

const TONE_DOT = { green: toneVar('positive'), yellow: toneVar('warning'), red: toneVar('critical') } as const

const fmtRate = (n: number): string => (n >= 100 ? Math.round(n).toString() : n.toFixed(n >= 10 ? 1 : 2))
const fmtMs = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`)

/** How the up-verdict was reached, in the user's words. Null = nothing to claim. */
const PROVENANCE: Record<ProductStatus['source'], string | null> = {
  probe: 'live probe',
  datastore: 'hanzo_service_up',
  unreachable: null,
  'unknown-service': null,
}

/**
 * Fuse the up-verdict with the error rate into ONE headline. Up/down comes only from the
 * status read; the error rate may DOWNGRADE the wording but can never make a down service
 * read as up, nor invent a verdict when nothing reported.
 */
function headline(status: ProductStatus, red: ServiceMetrics | null): { tone: 'green' | 'yellow' | 'red'; label: string } {
  if (!status.up) return { tone: 'red', label: 'Not reachable' }
  const rate = red?.hasData ? errorRateTone(red.summary.errorRate) : 'green'
  if (rate === 'red') return { tone: 'red', label: 'Degraded' }
  if (rate === 'yellow') return { tone: 'yellow', label: 'Elevated errors' }
  return { tone: 'green', label: 'Operational' }
}

export function ProductStatusView({ entry }: { entry: CatalogEntry }) {
  const { service, o11yService } = subpageSourcesFor(entry)
  const [deploy, setDeploy] = useState<DeployState>({ phase: 'loading' })
  const [o11y, setO11y] = useState<O11yState>({ phase: 'loading' })

  const load = useCallback(() => {
    // Sources 1+2 — the up-verdict and the RED window. Neither throws; a miss resolves to an
    // honest not-reachable / no-telemetry, so the band is omitted rather than faked.
    if (o11yService) {
      setO11y({ phase: 'loading' })
      void Promise.all([
        O11yStatusApi.product(o11yService),
        O11yMetricsApi.service(o11yService, { rangeSec: 3600 }),
      ]).then(([status, red]) => setO11y({ phase: 'ready', status, red }))
    } else {
      setO11y({ phase: 'ready', status: null, red: null })
    }

    // Source 3 — deployment state (admin-scoped control-plane inventory).
    if (service) {
      setDeploy({ phase: 'loading' })
      PlatformApi.apps()
        .then((all) => setDeploy({ phase: 'ready', rows: all.filter((a) => a.app === service) }))
        .catch((e) => setDeploy({ phase: 'error', error: interpretPlatformError(e) }))
    } else {
      setDeploy({ phase: 'ready', rows: [] })
    }
  }, [service, o11yService])

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

  const status = o11y.phase === 'ready' ? o11y.status : null
  const red = o11y.phase === 'ready' ? o11y.red : null
  const deployRows = deploy.phase === 'ready' ? deploy.rows : []
  const loading = o11y.phase === 'loading' || deploy.phase === 'loading'
  // A band is only shown when o11y actually answered AND has something to say about a real
  // workload. `unknown-service` means no backing workload — that is not a status.
  const showBand = Boolean(status?.reachable && status.source !== 'unknown-service')
  const nothingToReport = deploy.phase !== 'error' && !showBand && deployRows.length === 0 && !loading

  return (
    <>
      <PageHeader
        title={`${entry.label} · Status`}
        subtitle={`Live health of ${entry.label} — probe, service gauge, and deployment across your clusters.`}
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      {loading ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Probing {entry.label}…</Text>
        </XStack>
      ) : (
        <YStack gap="$3">
          {showBand && status ? <StatusBand label={entry.label} status={status} red={red} /> : null}

          {/* o11y answered but this slug has no backing workload — say so plainly. */}
          {status?.reachable && status.source === 'unknown-service' ? (
            <NoWorkloadCard entry={entry} service={o11yService ?? ''} />
          ) : null}

          {/* Deployment state (admin control-plane inventory). */}
          {deploy.phase === 'error' ? (
            // A customer 403 on the admin inventory is not an error when o11y already gave a verdict.
            showBand ? null : <PlatformStateCard error={deploy.error} onRetry={load} />
          ) : deployRows.length > 0 ? (
            <YStack gap="$3">
              {(() => {
                const v = verdict(deployRows)
                return (
                  <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2.5" maxWidth={720}>
                    <XStack items="center" gap="$2" flexWrap="wrap">
                      <YStack width={10} height={10} rounded="$10" style={{ backgroundColor: TONE_DOT[v.tone] }} />
                      <Text fontSize="$5" fontWeight="800" color="$color12">{v.label}</Text>
                      <Text fontSize="$2" color="$color10">
                        · deployment · {deployRows.filter(isUp).length}/{deployRows.length} healthy ·{' '}
                        {new Set(deployRows.map((r) => r.cluster)).size}{' '}
                        {new Set(deployRows.map((r) => r.cluster)).size === 1 ? 'cluster' : 'clusters'}
                      </Text>
                    </XStack>
                  </Card>
                )
              })()}
              <DataTable
                columns={columns}
                rows={deployRows}
                rowKey={(r) => r.id}
                empty={`No running ${entry.label} service reported for your organization.`}
              />
            </YStack>
          ) : null}

          {nothingToReport ? <ManagedCard entry={entry} hasService={Boolean(service || o11yService)} status={status} /> : null}
        </YStack>
      )}
    </>
  )
}

/** The live band — up-verdict with its provenance, refined by the RED window. */
function StatusBand({ label, status, red }: { label: string; status: ProductStatus; red: ServiceMetrics | null }) {
  const v = headline(status, red)
  const provenance = PROVENANCE[status.source]
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2.5" maxWidth={720}>
      <XStack items="center" gap="$2" flexWrap="wrap">
        <YStack width={10} height={10} rounded="$10" style={{ backgroundColor: TONE_DOT[v.tone] }} />
        <Text fontSize="$5" fontWeight="800" color="$color12">{v.label}</Text>
        {provenance ? <Text fontSize="$2" color="$color10">· via {provenance}</Text> : null}
      </XStack>

      <XStack gap="$5" flexWrap="wrap">
        {/* Trap A: latency exists ONLY for a successful probe — the wire sends 0 for every
            failure, so anything else must render an em-dash, not a confident "0ms". */}
        <Metric label="Probe latency" value={status.probeLatencyMs === null ? '—' : fmtMs(status.probeLatencyMs)} icon />
        {red?.hasData ? (
          <>
            <Metric
              label="Error rate"
              value={`${fmtRate(red.summary.errorRate)}%`}
              tone={v.tone === 'green' ? undefined : v.tone}
            />
            <Metric label="p95 latency" value={fmtMs(red.summary.p95Ms)} />
            <Metric label="Requests (1h)" value={red.summary.requests.toLocaleString()} />
          </>
        ) : (
          <Metric label="Requests (1h)" value="—" />
        )}
      </XStack>

      <Text fontSize="$1" color="$color10">
        {status.source === 'probe'
          ? `A live probe reached ${label} and it answered.`
          : `No probe answered; this verdict is the hanzo_service_up gauge reported by ${label}.`}{' '}
        {red?.hasData
          ? 'Error rate and p95 are RED metrics from your organization’s own traces over the last hour.'
          : 'No request telemetry in the last hour, so error rate and latency show an em-dash rather than a fabricated zero.'}
      </Text>
    </Card>
  )
}

function Metric({ label, value, tone, icon }: { label: string; value: string; tone?: 'yellow' | 'red'; icon?: boolean }) {
  const color = tone === 'red' ? '$red10' : tone === 'yellow' ? '$yellow10' : '$color12'
  return (
    <YStack gap="$0.5">
      <XStack gap="$1" items="center">
        {icon ? <Activity size={12} color="$color10" /> : null}
        <Text fontSize="$1" color="$color10">{label}</Text>
      </XStack>
      <Text fontSize="$5" fontWeight="800" color={color}>{value}</Text>
    </YStack>
  )
}

/** o11y answered, but the slug has no backing workload — explicitly not a failure. */
function NoWorkloadCard({ entry, service }: { entry: CatalogEntry; service: string }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={680}>
      <XStack gap="$2" items="center">
        <CheckCircle2 size={16} color="$color10" />
        <Text fontSize="$4" fontWeight="700">{entry.label} · nothing to report</Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        The o11y runtime answered, but no workload is registered under service{' '}
        <Text fontSize="$3" color="$color12" fontWeight="600">{service}</Text>. That is not a failure and not a
        red status — there is simply nothing running under that name to probe. Health appears here automatically
        once {entry.label} registers a service.
      </Text>
    </Card>
  )
}

/** Honest managed-capability card — no discrete service reports to any source. */
function ManagedCard({ entry, hasService, status }: { entry: CatalogEntry; hasService: boolean; status: ProductStatus | null }) {
  const unreachable = status && !status.reachable
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
      <XStack gap="$2" items="center">
        <CheckCircle2 size={16} color={unreachable ? '$color10' : '$green10'} />
        <Text fontSize="$4" fontWeight="700">
          {unreachable
            ? `${entry.label} · status unavailable`
            : hasService
              ? `${entry.label} · no telemetry reported`
              : `${entry.label} · managed by Hanzo`}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {unreachable
          ? `The o11y runtime did not answer (HTTP ${status?.status || 'error'}), so no status can be shown for ${entry.label}. Nothing is fabricated — this says only that the health source is unavailable right now, not that the service is down.`
          : hasService
            ? `Neither the o11y runtime nor the control-plane inventory reports a running ${entry.label} service for your organization right now. It may be a shared managed service reported elsewhere, or idle in this window — its live health lights up automatically once it serves traffic or is reported. No status is fabricated.`
            : `${entry.label} is a managed Hanzo Cloud capability with no discrete service to report health for. It is available through the API; there is no fabricated status shown.`}
      </Text>
    </Card>
  )
}
