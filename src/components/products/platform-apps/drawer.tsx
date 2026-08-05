'use client'

/**
 * Drawer tab bodies for the App Platform canvas — the per-app management surface
 * (Overview · Deployments · Variables · Metrics · Logs · Domains · SBOM), fed
 * into `@hanzo/canvas`'s `ServiceDetailDrawer`. This REUSES the existing
 * `/v1/platform` client + `platform-apps/logic` (deploy/stop/start, masked env,
 * source-tagged logs, verified domains, image SBOM) — no duplicated data layer.
 * Each tab is its own component, so it fetches only when its tab is opened.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, Globe, KeyRound, Play, Plus, Rocket, ScrollText, Square, Trash2 } from '@hanzogui/lucide-icons-2'
import { DeployTimeline, MetricSparkline, toEpochMs, type DeployEvent, type DrawerTab, type ServiceNodeData } from '@hanzo/canvas'

import {
  PlatformAppsApi,
  type PlatformApp,
  type PlatformDeploymentLogs,
  type Sbom,
  type SbomComponent,
} from '~/lib/api/platform-apps'
import { METRICS_RANGES, O11yMetricsApi, type ServiceMetrics } from '~/lib/api/o11y-metrics'
import { ApiError } from '~/lib/api'
import { DomainsPanel } from '../paas/DomainsPanel'
import { isTerminalPhase, railwayPhase } from '../paas/railway'
import { usePoll } from '../overview/living/hooks'
import {
  appDisplayStatus,
  appImageRef,
  canDeploy,
  draftsToEnv,
  isDeployed,
  logSourceLabel,
  maskedEnvRows,
  secretCount,
  secretSyncLabel,
  toEnvDrafts,
  validateEnvDrafts,
  type EnvDraft,
} from './logic'
import { toneVar } from '~/components/ui/tone'
import { DataTable, FieldText, PrimaryButton, StatusTag, type Column } from '@hanzo/ui/product'

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

/**
 * Variables tab — the app's env: a masked read view (secrets never rendered) that
 * flips into a full add/edit/delete editor writing through `setEnv` (PUT .../env).
 * Secrets are write-only: an existing one is kept (or Replaced), never revealed.
 */
function VariablesTab({ app, project, onChanged }: { app: PlatformApp; project: string; onChanged: (a: PlatformApp) => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <EnvEditor
        app={app}
        project={project}
        onDone={(updated) => {
          if (updated) onChanged(updated)
          setEditing(false)
        }}
      />
    )
  }

  const rows = maskedEnvRows(app.env)
  return (
    <YStack gap="$2">
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$2">
          <KeyRound size={14} />
          <Text fontSize="$2" color="$color11">
            {rows.length === 0
              ? 'No variables'
              : secretCount(app.env) > 0
                ? `${rows.length} variable${rows.length === 1 ? '' : 's'} · ${secretCount(app.env)} secret`
                : `${rows.length} variable${rows.length === 1 ? '' : 's'}`}
          </Text>
        </XStack>
        <Button size="$2" onPress={() => setEditing(true)}>
          {rows.length === 0 ? 'Add variables' : 'Edit'}
        </Button>
      </XStack>
      {rows.length > 0 ? (
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
      ) : null}
    </YStack>
  )
}

const newDraftId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `new-${Math.random().toString(36).slice(2)}`

/** The env editor — one row per var; secrets are write-only (Replace/Keep). */
function EnvEditor({ app, project, onDone }: { app: PlatformApp; project: string; onDone: (updated?: PlatformApp) => void }) {
  const [drafts, setDrafts] = useState<EnvDraft[]>(() => toEnvDrafts(app.env))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const patch = (id: string, next: Partial<EnvDraft>) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...next } : d)))
  const remove = (id: string) => setDrafts((ds) => ds.filter((d) => d.id !== id))
  const add = (secret: boolean) =>
    setDrafts((ds) => [...ds, { id: newDraftId(), key: '', value: '', secret, sealed: false, replace: false }])

  const save = async () => {
    const invalid = validateEnvDrafts(drafts)
    if (invalid) {
      setErr(invalid)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const updated = await PlatformAppsApi.setEnv(project, app.slug, draftsToEnv(drafts))
      onDone({ ...updated, projectSlug: app.projectSlug ?? project })
    } catch (e) {
      setErr(
        e instanceof ApiError && e.status === 503
          ? 'Secrets service unavailable — no changes were saved.'
          : e instanceof Error
            ? e.message
            : 'Could not save variables.',
      )
      setBusy(false)
    }
  }

  return (
    <YStack gap="$3">
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$2">
          <KeyRound size={14} />
          <Text fontSize="$2" color="$color11">
            Environment variables
          </Text>
        </XStack>
        <XStack gap="$2">
          <Button size="$2" disabled={busy} onPress={() => onDone()}>
            Cancel
          </Button>
          <PrimaryButton size="$2" icon={busy ? <Spinner size="small" /> : undefined} disabled={busy} onPress={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </XStack>
      </XStack>

      {drafts.length === 0 ? (
        <Text fontSize="$2" color="$color10">
          No variables yet — add a plain variable or a secret.
        </Text>
      ) : (
        <YStack gap="$2">
          {drafts.map((d) => (
            <EnvRow key={d.id} d={d} disabled={busy} onPatch={(n) => patch(d.id, n)} onRemove={() => remove(d.id)} />
          ))}
        </YStack>
      )}

      <XStack gap="$2">
        <Button size="$2" icon={<Plus size={14} />} disabled={busy} onPress={() => add(false)}>
          Variable
        </Button>
        <Button size="$2" icon={<Plus size={14} />} disabled={busy} onPress={() => add(true)}>
          Secret
        </Button>
      </XStack>

      {err ? (
        <Text fontSize="$2" color="$red10">
          {err}
        </Text>
      ) : null}
      <Text fontSize="$1" color="$color9">
        Secret values are sealed into KMS server-side — never stored or shown in plaintext. Pods pick up changes on their next deploy.
      </Text>
    </YStack>
  )
}

/** One editable row: key + value (or a write-only secret) + remove. */
function EnvRow({ d, disabled, onPatch, onRemove }: { d: EnvDraft; disabled?: boolean; onPatch: (n: Partial<EnvDraft>) => void; onRemove: () => void }) {
  return (
    <XStack gap="$2" items="flex-start">
      <YStack flex={1} minW={0}>
        <FieldText value={d.key} onChange={(key) => onPatch({ key })} disabled={disabled || d.sealed} placeholder="KEY" />
      </YStack>
      <YStack flex={1} minW={0} gap="$1">
        {d.secret && d.sealed && !d.replace ? (
          <XStack items="center" justify="space-between" gap="$2" height={40} px="$1">
            <Text fontSize="$2" color="$color10" style={{ fontFamily: MONO }}>
              •••••••• set
            </Text>
            <Button size="$1" onPress={() => onPatch({ replace: true })} disabled={disabled}>
              Replace
            </Button>
          </XStack>
        ) : (
          <>
            <FieldText
              value={d.value}
              onChange={(value) => onPatch({ value })}
              disabled={disabled}
              secure={d.secret}
              placeholder={d.secret ? 'secret value' : 'value'}
            />
            {d.secret && d.sealed && d.replace ? (
              <Button size="$1" self="flex-start" onPress={() => onPatch({ replace: false, value: '' })} disabled={disabled}>
                Keep current
              </Button>
            ) : null}
          </>
        )}
      </YStack>
      <XStack items="center" gap="$1" pt="$1.5">
        {d.secret ? (
          <Text fontSize="$1" color="$color10">
            secret
          </Text>
        ) : null}
        <Button size="$1" chromeless icon={<Trash2 size={14} />} onPress={onRemove} disabled={disabled} aria-label={`Remove ${d.key || 'variable'}`} />
      </XStack>
    </XStack>
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
      <MetricSparkline points={points} width={96} height={28} stroke={tone ?? toneVar('positive')} strokeWidth={1.5} fill="var(--color5)" />
    </XStack>
  )
}

const fmt = (n: number, dp = 0): string => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: dp }).format(n)

/**
 * Metrics tab — REAL per-service RED metrics from the cloud o11y surface
 * (`GET /v1/o11y/product/metrics?product=<slug>`): requests, error rate, and p95 latency
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
            tone={toneVar('positive')}
          />
          <MetricRow
            label="Error rate"
            value={`${m.summary.errorRate.toFixed(m.summary.errorRate < 10 ? 1 : 0)}%`}
            sub={`${fmt(m.summary.errors, 1)} errors`}
            points={m.errors.map((p) => p.v)}
            tone={toneVar(m.summary.errorRate >= 5 ? 'critical' : m.summary.errorRate >= 1 ? 'warning' : 'positive')}
          />
          <MetricRow
            label="Latency p95"
            value={`${Math.round(m.summary.p95Ms)} ms`}
            points={m.latencyP95Ms.map((p) => p.v)}
            tone={toneVar('neutral')}
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

/**
 * Logs tab — source-tagged build/app logs for the latest deployment, LIVE-TAILED
 * while a build/deploy is in progress. The endpoint returns a full snapshot (no SSE),
 * so it polls on an interval and auto-scrolls, stopping once the deployment reaches a
 * terminal phase (live/error). Reuses the `railway` phase model the pipeline tracks.
 */
const LOG_POLL_MS = 2000

function LogsTab({ app, project }: { app: PlatformApp; project: string }) {
  const [logs, setLogs] = useState<PlatformDeploymentLogs | null>(null)
  const [depStatus, setDepStatus] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const phase = railwayPhase(depStatus)
  const streaming = logs != null && logs.source !== 'none' && phase !== 'idle' && !isTerminalPhase(phase)
  const { tick } = usePoll(streaming ? LOG_POLL_MS : 0)

  const load = useCallback(async () => {
    try {
      const deps = await PlatformAppsApi.listDeployments(project, app.slug)
      if (deps.length === 0) {
        setDepStatus(undefined)
        setLogs({ deploymentId: '', source: 'none', logs: 'No deployments yet — deploy this app to see build and runtime logs.' })
        return
      }
      const latest = deps[0]
      setDepStatus(latest.status)
      setLogs(await PlatformAppsApi.deploymentLogs(project, app.slug, latest.id))
    } catch {
      setDepStatus(undefined)
      setLogs({ deploymentId: '', source: 'none', logs: 'Logs are not available right now.' })
    } finally {
      setLoading(false)
    }
  }, [project, app.slug])

  // Initial load, then re-load on each poll tick while streaming.
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (tick > 0) void load()
  }, [tick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the tail as new lines arrive while streaming.
  useEffect(() => {
    const el = scrollRef.current
    if (el && streaming) el.scrollTop = el.scrollHeight
  }, [logs, streaming])

  return (
    <YStack gap="$2">
      <XStack items="center" gap="$2">
        <ScrollText size={14} />
        {streaming ? <YStack width={8} height={8} rounded="$10" bg="$green10" className="hz-rail-dot" /> : null}
        <Text fontSize="$2" color="$color11">
          {streaming ? `Streaming ${logSourceLabel(logs?.source).toLowerCase()}…` : logSourceLabel(logs?.source)}
        </Text>
        <Button size="$1" disabled={loading} onPress={() => void load()}>
          Refresh
        </Button>
      </XStack>
      <YStack bg="$color1" borderWidth={1} borderColor="$borderColor" rounded="$3" p="$3">
        {loading && !logs ? (
          <Spinner size="small" color="$color11" />
        ) : (
          <div ref={scrollRef} style={{ maxHeight: 340, overflowY: 'auto' }}>
            <Text fontSize="$1" color="$color11" style={{ fontFamily: MONO, whiteSpace: 'pre-wrap' }}>
              {logs?.logs || '—'}
            </Text>
          </div>
        )}
      </YStack>
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
    { id: 'variables', label: 'Variables', badge: (app.env ?? []).length || undefined, content: <VariablesTab app={app} project={project} onChanged={onChanged} /> },
    { id: 'metrics', label: 'Metrics', content: <MetricsTab app={app} /> },
    { id: 'logs', label: 'Logs', content: <LogsTab app={app} project={project} /> },
    { id: 'domains', label: 'Domains', badge: app.domains?.length || undefined, content: <DomainsPanel projectSlug={app.projectSlug ?? project} appSlug={app.slug} /> },
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
