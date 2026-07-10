'use client'

/**
 * Drawer tab bodies for the App Platform canvas — the per-app management surface
 * (Overview · Deployments · Variables · Metrics · Logs · Domains · SBOM), fed
 * into `@hanzo/canvas`'s `ServiceDetailDrawer`. This REUSES the existing
 * `/v1/platform` client + `platform-apps/logic` (deploy/stop/start, masked env,
 * source-tagged logs, verified domains, image SBOM) — no duplicated data layer.
 * Each tab is its own component, so it fetches only when its tab is opened.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, Globe, KeyRound, Play, Rocket, ScrollText, Square } from '@hanzogui/lucide-icons-2'
import { DeployTimeline, MetricSparkline, toEpochMs, type DeployEvent, type DrawerTab, type ServiceNodeData } from '@hanzo/canvas'

import {
  PlatformAppsApi,
  type PlatformApp,
  type PlatformDeploymentLogs,
  type PlatformDomain,
  type Sbom,
  type SbomComponent,
} from '~/lib/api/platform-apps'
import { METRICS_RANGES, O11yMetricsApi, type ServiceMetrics } from '~/lib/api/o11y-metrics'
import { ApiError } from '~/lib/api'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { StatusTag } from '~/components/ui/StatusTag'
import {
  appDisplayStatus,
  appImageRef,
  canDeploy,
  isDeployed,
  logSourceLabel,
  maskedEnvRows,
  secretCount,
  secretSyncLabel,
} from './logic'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <XStack justify="space-between" items="center" py="$1.5" borderBottomWidth={1} borderColor="$borderColor" gap="$3">
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" fontWeight="600" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

const sbomColumns: Column<SbomComponent>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (c) => (
      <Text fontSize="$2" numberOfLines={1} style={{ fontFamily: MONO }}>
        {c.name}
      </Text>
    ),
  },
  { key: 'version', header: 'Version', width: 90, render: (c) => <Text fontSize="$2" numberOfLines={1}>{c.version || '—'}</Text> },
  { key: 'type', header: 'Type', width: 90, render: (c) => <Text fontSize="$2" numberOfLines={1}>{c.type || '—'}</Text> },
  { key: 'license', header: 'License', width: 110, render: (c) => <Text fontSize="$2" numberOfLines={1}>{c.license || '—'}</Text> },
]

/** Overview tab — facts + lifecycle actions (deploy/stop/start). */
function OverviewTab({
  app,
  project,
  onChanged,
  onRefreshList,
}: {
  app: PlatformApp
  project: string
  onChanged: (a: PlatformApp) => void
  onRefreshList: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const act = useCallback(
    async (name: string, fn: () => Promise<PlatformApp>) => {
      setBusy(name)
      setErr(null)
      try {
        const updated = await fn()
        onChanged({ ...updated, projectSlug: project })
        onRefreshList()
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [onChanged, onRefreshList, project],
  )

  return (
    <YStack gap="$3">
      <XStack gap="$2" flexWrap="wrap">
        <PrimaryButton
          size="$3"
          icon={Rocket}
          disabled={!!busy || !canDeploy(app)}
          onPress={() =>
            void act('deploy', () => PlatformAppsApi.deploy(project, app.slug).then(() => PlatformAppsApi.getApp(project, app.slug)))
          }
        >
          {busy === 'deploy' ? 'Deploying…' : 'Deploy'}
        </PrimaryButton>
        {isDeployed(app) && app.status !== 'stopped' ? (
          <Button size="$3" icon={Square} disabled={!!busy} onPress={() => void act('stop', () => PlatformAppsApi.stop(project, app.slug))}>
            Stop
          </Button>
        ) : isDeployed(app) ? (
          <Button size="$3" icon={Play} disabled={!!busy} onPress={() => void act('start', () => PlatformAppsApi.start(project, app.slug))}>
            Start
          </Button>
        ) : null}
      </XStack>
      {err ? (
        <Text fontSize="$2" color="$red10">
          {err}
        </Text>
      ) : null}

      <YStack>
        <Fact label="Status" value={<StatusTag status={appDisplayStatus(app)} />} />
        <Fact label="Project" value={app.projectSlug || project || '—'} />
        <Fact label="Environment" value={app.environment} />
        <Fact label="Source" value={app.source} />
        <Fact label="Image" value={app.source === 'image' ? appImageRef(app) || '—' : app.repo?.url || '—'} />
        <Fact label="Replicas" value={app.replicas} />
        <Fact label="Namespace" value={app.namespace || '—'} />
      </YStack>

      {secretSyncLabel(app) ? (
        <XStack gap="$2" items="center">
          <StatusTag status={app.secretSync} />
          {app.secretSyncDetail ? (
            <Text fontSize="$1" color="$color10" numberOfLines={2}>
              {app.secretSyncDetail}
            </Text>
          ) : null}
        </XStack>
      ) : null}
    </YStack>
  )
}

/** Deployments tab — the real deployment history as a timeline. */
function DeploymentsTab({ app, project }: { app: PlatformApp; project: string }) {
  const [events, setEvents] = useState<DeployEvent[] | null>(null)
  useEffect(() => {
    let live = true
    PlatformAppsApi.listDeployments(project, app.slug)
      .then((deps) => {
        if (!live) return
        setEvents(
          deps.map((d) => ({
            id: d.id,
            status: d.status,
            ref: d.version ? `v${d.version}` : d.commit?.slice(0, 7),
            source: d.source,
            message: d.message,
            createdAt: toEpochMs(d.createdAt),
          })),
        )
      })
      .catch(() => live && setEvents([]))
    return () => {
      live = false
    }
  }, [project, app.slug])

  if (events === null) return <Spinner size="small" color="$color11" />
  return <DeployTimeline events={events} emptyLabel="No deployments yet — deploy this app to see its history." />
}

/** Variables tab — secret-masked env (the backend already blanks secrets). */
function VariablesTab({ app }: { app: PlatformApp }) {
  const rows = maskedEnvRows(app.env)
  if (rows.length === 0) {
    return (
      <Text fontSize="$2" color="$color10">
        No environment variables.
      </Text>
    )
  }
  return (
    <YStack gap="$2">
      <XStack items="center" gap="$2">
        <KeyRound size={14} />
        <Text fontSize="$2" color="$color11">
          {secretCount(app.env) > 0 ? `${secretCount(app.env)} secret` : `${rows.length} variable${rows.length === 1 ? '' : 's'}`}
        </Text>
      </XStack>
      <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
        {rows.map((e) => (
          <XStack key={e.key} py="$2" px="$3" gap="$3" borderBottomWidth={1} borderColor="$borderColor" items="center">
            <Text fontSize="$2" flex={1} numberOfLines={1} style={{ fontFamily: MONO }}>
              {e.key}
            </Text>
            <Text fontSize="$2" color={e.secret ? '$color10' : '$color12'} flex={1} numberOfLines={1} style={{ fontFamily: MONO }}>
              {e.value || '""'}
            </Text>
            {e.secret ? (
              <Text fontSize="$1" color="$color10">
                secret
              </Text>
            ) : null}
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}

/** A labeled metric row — value + optional sub-stat + a real sparkline of the series. */
function MetricRow({ label, value, sub, points, tone }: { label: string; value: string; sub?: string; points: number[]; tone?: string }) {
  return (
    <XStack items="center" justify="space-between" gap="$3" py="$2.5" borderBottomWidth={1} borderColor="$borderColor">
      <YStack gap="$0.5" minW={0}>
        <Text fontSize="$1" color="$color10">
          {label}
        </Text>
        <XStack items="baseline" gap="$2">
          <Text fontSize="$5" fontWeight="800" color="$color12">
            {value}
          </Text>
          {sub ? (
            <Text fontSize="$1" color="$color10">
              {sub}
            </Text>
          ) : null}
        </XStack>
      </YStack>
      <MetricSparkline points={points} width={96} height={28} stroke={tone ?? '#2ea043'} strokeWidth={1.5} fill={`${tone ?? '#2ea043'}22`} />
    </XStack>
  )
}

const fmt = (n: number, dp = 0): string => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: dp }).format(n)

/**
 * Metrics tab — REAL per-service RED metrics from the cloud o11y surface
 * (`GET /v1/o11y/metrics?product=<slug>`): requests, error rate, and p95 latency
 * over a selectable window, each with its live time-series sparkline. Honest states:
 * loading; o11y-not-connected (503/404/401/403); and "connected · no telemetry yet"
 * when o11y answered but this service emits none. Per-service CPU/memory are not
 * exposed by this RED (trace-derived) read, so they are labeled honestly — never a
 * fabricated chart.
 */
function MetricsTab({ app }: { app: PlatformApp }) {
  const [rangeSec, setRangeSec] = useState<number>(3600)
  const [m, setM] = useState<ServiceMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    O11yMetricsApi.service(app.slug, { rangeSec })
      .then((r) => live && setM(r))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [app.slug, rangeSec])

  const RangeBar = (
    <XStack gap="$1" items="center">
      {METRICS_RANGES.map((r) => {
        const on = r.id === rangeSec
        return (
          <XStack
            key={r.id}
            px="$2"
            py="$1"
            rounded="$2"
            bg={on ? '$color4' : 'transparent'}
            onPress={() => setRangeSec(r.id)}
            style={{ cursor: 'pointer' }}
          >
            <Text fontSize="$1" fontWeight={on ? '700' : '500'} color={on ? '$color12' : '$color10'}>
              {r.label}
            </Text>
          </XStack>
        )
      })}
    </XStack>
  )

  return (
    <YStack gap="$3">
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$2">
          <Activity size={14} />
          <Text fontSize="$2" color="$color11">
            {app.slug}
          </Text>
        </XStack>
        {RangeBar}
      </XStack>

      {loading && !m ? (
        <Spinner size="small" color="$color11" />
      ) : m && !m.connected ? (
        <YStack gap="$2" py="$2">
          <Text fontSize="$3" fontWeight="600" color="$color12">
            Metrics runtime not connected
          </Text>
          <Text fontSize="$2" color="$color10">
            The observability service is not reachable on this deployment yet. Requests, errors, and latency for this app appear
            here as soon as o11y is wired — we never show a fabricated chart.
          </Text>
        </YStack>
      ) : m && !m.hasData ? (
        <YStack gap="$2" py="$2">
          <Text fontSize="$3" fontWeight="600" color="$color12">
            Connected · no telemetry yet
          </Text>
          <Text fontSize="$2" color="$color10">
            o11y answered but <Text style={{ fontFamily: MONO }}>{app.slug}</Text> has emitted no request telemetry in the last{' '}
            {METRICS_RANGES.find((r) => r.id === rangeSec)?.label}. Real request, error, and latency charts render here once the
            service reports traffic.
          </Text>
        </YStack>
      ) : m ? (
        <YStack>
          <MetricRow
            label="Requests"
            value={fmt(m.summary.requests, 1)}
            sub={`in the last ${METRICS_RANGES.find((r) => r.id === rangeSec)?.label}`}
            points={m.requests.map((p) => p.v)}
            tone="#2ea043"
          />
          <MetricRow
            label="Error rate"
            value={`${m.summary.errorRate.toFixed(m.summary.errorRate < 10 ? 1 : 0)}%`}
            sub={`${fmt(m.summary.errors, 1)} errors`}
            points={m.errors.map((p) => p.v)}
            tone={m.summary.errorRate >= 5 ? '#e5534b' : m.summary.errorRate >= 1 ? '#bb8009' : '#2ea043'}
          />
          <MetricRow
            label="Latency p95"
            value={`${Math.round(m.summary.p95Ms)} ms`}
            points={m.latencyP95Ms.map((p) => p.v)}
            tone="#539bf5"
          />
          <Text fontSize="$1" color="$color9" pt="$2">
            Requests, errors, and latency are live from o11y (RED, trace-derived). Per-service CPU and memory are not exposed by
            this metrics API — they are omitted rather than estimated.
          </Text>
        </YStack>
      ) : null}
    </YStack>
  )
}

/** Logs tab — source-tagged build/app logs for the latest deployment. */
function LogsTab({ app, project }: { app: PlatformApp; project: string }) {
  const [logs, setLogs] = useState<PlatformDeploymentLogs | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const deps = await PlatformAppsApi.listDeployments(project, app.slug)
      if (deps.length === 0) {
        setLogs({ deploymentId: '', source: 'none', logs: 'No deployments yet — deploy this app to see build and runtime logs.' })
        return
      }
      setLogs(await PlatformAppsApi.deploymentLogs(project, app.slug, deps[0].id))
    } catch {
      setLogs({ deploymentId: '', source: 'none', logs: 'Logs are not available right now.' })
    } finally {
      setLoading(false)
    }
  }, [project, app.slug])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <YStack gap="$2">
      <XStack items="center" gap="$2">
        <ScrollText size={14} />
        <Text fontSize="$2" color="$color11">
          {logSourceLabel(logs?.source)}
        </Text>
        <Button size="$1" disabled={loading} onPress={() => void load()}>
          Refresh
        </Button>
      </XStack>
      <YStack bg="$color1" borderWidth={1} borderColor="$borderColor" rounded="$3" p="$3">
        {loading ? (
          <Spinner size="small" color="$color11" />
        ) : (
          <Text fontSize="$1" color="$color11" style={{ fontFamily: MONO, whiteSpace: 'pre-wrap' }}>
            {logs?.logs || '—'}
          </Text>
        )}
      </YStack>
    </YStack>
  )
}

/** Domains tab — verified custom domains with DNS records to publish. */
function DomainsTab({ app, project }: { app: PlatformApp; project: string }) {
  const [domains, setDomains] = useState<PlatformDomain[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setDomains(await PlatformAppsApi.listDomains(project, app.slug))
    } catch {
      setDomains([])
    }
  }, [project, app.slug])

  useEffect(() => {
    void load()
  }, [load])

  const verify = useCallback(
    async (host: string) => {
      setBusy(`verify:${host}`)
      try {
        await PlatformAppsApi.verifyDomain(project, app.slug, host)
        await load()
      } finally {
        setBusy(null)
      }
    },
    [project, app.slug, load],
  )

  if (domains === null) return <Spinner size="small" color="$color11" />
  if (domains.length === 0) {
    return (
      <Text fontSize="$2" color="$color10">
        No domains.
      </Text>
    )
  }
  return (
    <YStack gap="$2">
      {domains.map((d) => (
        <Card key={d.host} p="$3" gap="$2" borderWidth={1} borderColor="$borderColor">
          <XStack justify="space-between" items="center" gap="$2">
            <YStack flex={1}>
              <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
                {d.host}
              </Text>
              <Text fontSize="$1" color="$color10">
                {d.kind}
                {d.primary ? ' · primary' : ''}
              </Text>
            </YStack>
            <StatusTag status={d.status} />
          </XStack>
          {!d.verified && d.records && d.records.length > 0 ? (
            <YStack gap="$1" bg="$color2" p="$2" rounded="$2">
              <Text fontSize="$1" color="$color11">
                {d.detail || 'Publish these DNS records, then verify:'}
              </Text>
              {d.records.map((r) => (
                <Text key={`${r.type}-${r.name}`} fontSize="$1" numberOfLines={1} style={{ fontFamily: MONO }}>
                  {r.type} {r.name} → {r.value}
                </Text>
              ))}
              <Button size="$2" self="flex-start" disabled={busy === `verify:${d.host}`} onPress={() => void verify(d.host)}>
                {busy === `verify:${d.host}` ? 'Verifying…' : 'Verify'}
              </Button>
            </YStack>
          ) : null}
        </Card>
      ))}
    </YStack>
  )
}

/** SBOM tab — the components CI recorded for this image (cloud clients/sbom). */
function SbomTab({ app }: { app: PlatformApp }) {
  const [sbom, setSbom] = useState<Sbom | null>(null)
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const imageRef = appImageRef(app)

  useEffect(() => {
    let live = true
    if (!imageRef) {
      setSbom(null)
      setNote(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setNote(null)
    PlatformAppsApi.sbom(imageRef)
      .then((s) => live && setSbom(s))
      .catch((e) => {
        if (!live) return
        setNote(e instanceof ApiError && e.status === 503 ? 'SBOM datastore unavailable.' : 'Could not load the SBOM.')
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [imageRef])

  if (loading) return <Spinner size="small" color="$color11" />
  if (note)
    return (
      <Text fontSize="$2" color="$color10">
        {note}
      </Text>
    )
  if (sbom && sbom.components.length > 0) {
    return (
      <YStack gap="$2">
        <Text fontSize="$2" color="$color11">
          {sbom.componentCount} components
        </Text>
        <DataTable<SbomComponent> columns={sbomColumns} rows={sbom.components} rowKey={(c) => c.purl || `${c.name}@${c.version}`} />
      </YStack>
    )
  }
  return (
    <Text fontSize="$2" color="$color10">
      No SBOM recorded for this image yet.
    </Text>
  )
}

/** Build the tab set for an APP node — the full management surface. */
export function buildAppTabs(
  app: PlatformApp,
  project: string,
  onChanged: (a: PlatformApp) => void,
  onRefreshList: () => void,
): DrawerTab[] {
  return [
    { id: 'overview', label: 'Overview', content: <OverviewTab app={app} project={project} onChanged={onChanged} onRefreshList={onRefreshList} /> },
    { id: 'deployments', label: 'Deployments', content: <DeploymentsTab app={app} project={project} /> },
    { id: 'variables', label: 'Variables', badge: (app.env ?? []).length || undefined, content: <VariablesTab app={app} /> },
    { id: 'metrics', label: 'Metrics', content: <MetricsTab app={app} /> },
    { id: 'logs', label: 'Logs', content: <LogsTab app={app} project={project} /> },
    { id: 'domains', label: 'Domains', badge: app.domains?.length || undefined, content: <DomainsTab app={app} project={project} /> },
    { id: 'sbom', label: 'SBOM', content: <SbomTab app={app} /> },
  ]
}

/** Build the (single Overview) tab for a resource/domain node — facts + links. */
export function buildResourceTabs(node: ServiceNodeData): DrawerTab[] {
  return [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <YStack gap="$3">
          <YStack>
            <Fact label="Type" value={node.typeLabel ?? node.kind} />
            {node.statusLabel ? <Fact label="Status" value={<StatusTag status={node.statusLabel} />} /> : null}
            {node.capability ? <Fact label="Capability" value={node.capability.path} /> : null}
            {node.source ? <Fact label="Endpoint" value={node.source.ref} /> : null}
          </YStack>
          <XStack gap="$2" flexWrap="wrap">
            {node.href ? (
              <PrimaryButton size="$3" onPress={() => (typeof window !== 'undefined' ? window.location.assign(node.href!) : undefined)}>
                Open {node.capability?.label ?? node.typeLabel ?? 'product'}
              </PrimaryButton>
            ) : null}
            {node.externalHref ? (
              <Button
                size="$3"
                icon={Globe}
                onPress={() => (typeof window !== 'undefined' ? window.open(node.externalHref, '_blank', 'noopener') : undefined)}
              >
                Open site
              </Button>
            ) : null}
          </XStack>
        </YStack>
      ),
    },
  ]
}
