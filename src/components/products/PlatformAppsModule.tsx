'use client'

/**
 * App Platform — the per-org **Hanzo PaaS** rendered as a **Railway-grade project
 * canvas** over cloud's native `/v1/platform/*` control plane. A signed-in org
 * member sees every container app as a live service node, the domains that front
 * them, and the managed data resources they reference — pan/zoom, glance at
 * status, and open any node for the full management drawer (Deploy, Deployments,
 * Variables, Metrics, Logs, Domains, SBOM).
 *
 * All reusable canvas UI lives in `@hanzo/canvas` (brand/white-label aware via the
 * design tokens); this module owns only the DATA — it fetches `/v1/platform` apps
 * + `/v1/<kind>` resources and maps them (`platform-apps/canvas`) into the generic
 * node/edge model. Every state is honest: loading, empty (no apps → the CLI/API),
 * a `BackendStateCard` for a `/v1` failure, and NEVER a fabricated service or
 * metric.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Network, Plus, RefreshCw, Rocket } from '@hanzogui/lucide-icons-2'
import { useThemeSetting } from '@hanzogui/next-theme'
import { EnvSwitcher, ServiceDetailDrawer, type ServiceMetric, type ServiceNodeData } from '@hanzo/canvas'

import { PlatformAppsApi, type PlatformApp } from '~/lib/api/platform-apps'
import { ProvisioningApi, type ResourceKind } from '~/lib/api/provisioning'
import { ApmApi, apmWindow } from '~/lib/api/apm'
import { fetchCardMetrics } from './platform-apps/metrics'
import type { ServiceDepEdge } from './platform-apps/canvas'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { CreateAppForm } from './paas/CreateAppForm'
import { EmptyState } from '~/components/ui/EmptyState'
import { Loader } from '~/components/ui/Loader'
import { PageHeader } from '~/components/ui/PageHeader'
import { SlideOver } from '~/components/ui/SlideOver'
import { usePoll, useReducedMotion } from '~/components/products/overview/living/hooks'
import { buildProjectCanvas, summarizeCanvas, type CanvasResource } from './platform-apps/canvas'
import { renderServiceIcon } from './platform-apps/icons'
import { buildAppTabs, buildResourceTabs } from './platform-apps/drawer'
import { toneColor, toneVar } from '~/components/ui/tone'

/** The managed data kinds the provisioning service serves. */
const RESOURCE_KINDS: ResourceKind[] = ['sql', 'vector', 'kv', 'search', 's3', 'datastore', 'docdb']
const POLL_MS = 15_000

// `@xyflow/react` is browser-only — load the canvas client-side so SSR/prerender
// never evaluates it.
const ProjectCanvas = dynamic(() => import('@hanzo/canvas').then((m) => m.ProjectCanvas), {
  ssr: false,
  loading: () => <CanvasFrame><Loader label="Loading canvas…" /></CanvasFrame>,
})

type Data = { apps: PlatformApp[]; resources: CanvasResource[] }
type State = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: Data }

/** One composite read: apps (fatal) + managed resources (per-kind degrade to []). */
async function loadPlatform(): Promise<Data> {
  const apps = await PlatformAppsApi.listAllApps()
  const lists = await Promise.all(
    RESOURCE_KINDS.map((kind) =>
      ProvisioningApi.list(kind)
        .then((rs) => rs.map((r): CanvasResource => ({ kind, name: r.name, status: r.status, host: r.host, port: r.port, database: r.database })))
        .catch(() => [] as CanvasResource[]),
    ),
  )
  return { apps, resources: lists.flat() }
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card p="$3" gap="$1" borderWidth={1} borderColor="$borderColor" minW={110} flex={1}>
      <Text fontSize="$7" fontWeight="800" style={tone ? { color: tone } : undefined}>
        {value}
      </Text>
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
    </Card>
  )
}

export function PlatformAppsModule(_props: { params: Record<string, string> }) {
  const reducedMotion = useReducedMotion()
  const { current, resolvedTheme } = useThemeSetting()
  const theme: 'light' | 'dark' = (resolvedTheme ?? current ?? 'dark') === 'light' ? 'light' : 'dark'
  const { tick, bump } = usePoll(POLL_MS)

  const [state, setState] = useState<State>({ phase: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [project, setProject] = useState('')
  const [env, setEnv] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  useEffect(() => {
    let live = true
    setRefreshing(true)
    loadPlatform()
      .then((data) => live && setState({ phase: 'ready', data }))
      .catch((e) => live && setState((s) => (s.phase === 'ready' ? s : { phase: 'error', error: classifyBackend(e) })))
      .finally(() => live && setRefreshing(false))
    return () => {
      live = false
    }
  }, [tick])

  const data = state.phase === 'ready' ? state.data : null

  // Live o11y signals, fetched separately so the canvas fold stays pure. Card requests
  // sparkline per VISIBLE app + the observed runtime dependency graph. Both degrade to
  // empty on an o11y miss (honest — no fabricated sparkline / edge), keyed to refresh
  // with the data poll and on scope change.
  const [metricByApp, setMetricByApp] = useState<Map<string, ServiceMetric>>(new Map())
  const [serviceDeps, setServiceDeps] = useState<ServiceDepEdge[]>([])

  useEffect(() => {
    if (!data) return
    let live = true
    const scoped = data.apps.filter(
      (a) => (!project || a.projectSlug === project) && (!env || a.environment === env),
    )
    fetchCardMetrics(scoped)
      .then((m) => live && setMetricByApp(m))
      .catch(() => live && setMetricByApp(new Map()))
    ApmApi.dependencies(apmWindow(3600))
      .then((edges) => live && setServiceDeps(edges.map((e) => ({ parent: e.parent, child: e.child, callCount: e.callCount }))))
      .catch(() => live && setServiceDeps([]))
    return () => {
      live = false
    }
  }, [data, project, env])

  const model = useMemo(
    () => (data ? buildProjectCanvas(data, { project, env }, { metricByApp, serviceDeps }) : null),
    [data, project, env, metricByApp, serviceDeps],
  )
  const summary = useMemo(() => (model ? summarizeCanvas(model.nodes) : null), [model])

  // App lookup for the drawer (node id `app:<id>` → the PlatformApp).
  const appById = useMemo(() => {
    const m = new Map<string, PlatformApp>()
    for (const a of data?.apps ?? []) m.set(`app:${a.id}`, a)
    return m
  }, [data])

  const selected: ServiceNodeData | null = useMemo(
    () => (selectedId && model ? model.nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, model],
  )

  const refresh = useCallback(() => bump(), [bump])

  const drawerTabs = useMemo(() => {
    if (!selected) return []
    const app = appById.get(selected.id)
    if (app) return buildAppTabs(app, app.projectSlug ?? project, () => refresh(), () => refresh())
    return buildResourceTabs(selected)
  }, [selected, appById, project, refresh])

  const empty = state.phase === 'ready' && state.data.apps.length === 0

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="App Platform"
        subtitle="Your project's services on one live canvas — deploy, connect, and manage container apps."
        actions={
          <XStack gap="$2" items="center" flexWrap="wrap">
            {model && model.projects.length > 1 ? (
              <EnvSwitcher
                size="sm"
                value={project}
                onChange={setProject}
                options={[{ id: '', label: 'All projects' }, ...model.projects.map((p) => ({ id: p.id, label: p.label, count: p.count }))]}
              />
            ) : null}
            {model && model.envs.length > 1 ? (
              <EnvSwitcher
                size="sm"
                value={env}
                onChange={setEnv}
                options={[{ id: '', label: 'All' }, ...model.envs.map((e) => ({ id: e.id, label: e.label, count: e.count }))]}
              />
            ) : null}
            <Button size="$3" icon={Plus} onPress={() => setNewOpen(true)}>
              New service
            </Button>
            <Button size="$2" icon={RefreshCw} onPress={refresh} disabled={refreshing}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <BackendStateCard
          state={state.error}
          onRetry={refresh}
          hint="Apps you create with the Hanzo CLI or POST /v1/platform appear here as service nodes."
        />
      ) : state.phase === 'loading' ? (
        <Loader label="Loading your services…" />
      ) : empty ? (
        <EmptyState
          icon={Rocket}
          title="No services yet"
          description="Create a project and deploy a container app with the Hanzo CLI or the /v1/platform API. Each app shows up here as a live service node — with its domains, connected data, deploys, logs, and SBOM."
          bullets={[
            'Deploy from a git repo or a prebuilt image',
            'Set env — secret values are sealed in KMS, never plaintext',
            'Add a custom domain and verify it over DNS for automatic TLS',
          ]}
          primary={{ label: 'New service', onPress: () => setNewOpen(true) }}
        />
      ) : (
        <>
          {summary ? (
            <XStack gap="$3" flexWrap="wrap">
              <StatCard label="Services" value={summary.services} />
              <StatCard label="Active" value={summary.active} tone={summary.active ? toneVar('positive') : undefined} />
              <StatCard label="Deploying" value={summary.deploying} tone={summary.deploying ? toneVar('warning') : undefined} />
              <StatCard label="Crashed" value={summary.crashed} tone={summary.crashed ? toneVar('critical') : undefined} />
            </XStack>
          ) : null}
          <CanvasFrame>
            {model && model.nodes.length > 0 ? (
              <ProjectCanvas
                nodes={model.nodes}
                edges={model.edges}
                theme={theme}
                reducedMotion={reducedMotion}
                renderIcon={renderServiceIcon}
                onOpenDetail={(n) => setSelectedId(n.id)}
              />
            ) : (
              <ScopedEmpty onClear={() => { setProject(''); setEnv('') }} />
            )}
          </CanvasFrame>
        </>
      )}

      <ServiceDetailDrawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        service={selected}
        tabs={drawerTabs}
        reducedMotion={reducedMotion}
        renderIcon={renderServiceIcon}
      />

      <NewServicePanel open={newOpen} onClose={() => setNewOpen(false)} onDeployed={refresh} />
    </YStack>
  )
}

/** The bordered canvas viewport — one definite height so the canvas sizes itself. */
function CanvasFrame({ children }: { children: React.ReactNode }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden" p={0} bg="$color1" style={{ height: 'min(74vh, 820px)', minHeight: 460 }}>
      {children}
    </Card>
  )
}

/** When a project/env filter hides everything, an honest in-canvas note. */
function ScopedEmpty({ onClear }: { onClear: () => void }) {
  return (
    <YStack flex={1} items="center" justify="center" gap="$3" p="$6" style={{ height: '100%' }}>
      <Network size={28} color={toneColor('muted')} />
      <Text fontSize="$3" color="$color11">
        No services in this scope.
      </Text>
      <Button size="$3" onPress={onClear}>
        Show all
      </Button>
    </YStack>
  )
}

/** "+ New service" — the SAME create/deploy flow the Applications board uses
 *  (`CreateAppForm`): one create path, git repo or image, then the live pipeline. */
function NewServicePanel({ open, onClose, onDeployed }: { open: boolean; onClose: () => void; onDeployed: () => void }) {
  return (
    <SlideOver open={open} onClose={onClose} title="New service" size={560} ariaLabel="New service">
      <CreateAppForm
        onCancel={onClose}
        onDeployed={() => {
          onClose()
          onDeployed()
        }}
      />
    </SlideOver>
  )
}
