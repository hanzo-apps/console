'use client'

/**
 * Hanzo CD — the fleet deploy MAP (a Railway-grade board of the operator-managed
 * fleet), the surface cd.hanzo.ai serves.
 *
 * Every `hanzo.ai/v1` App CR is a live service node on one pannable/zoomable
 * `@hanzo/canvas` board, color-coded by its reconciled CD health. Tap a node for
 * the drill-in drawer: the owned-resource TOPOLOGY (Service CR → Deployment → RS →
 * Pods), the CI build timeline, and the git source — with
 * confirm-gated Sync + Rollback. The console holds NO cluster credentials; it
 * reads everything through cloud's `/v1/deploy/*` (authz server-side) and never
 * fabricates a row — a forbidden/not-routed read renders an honest state.
 *
 * Mobile-first: the board fills the viewport with touch pan/zoom, the drawer is a
 * full-screen sheet, the KPI band doubles as the health filter (big tap targets),
 * and nothing scrolls the page body horizontally. All the map/drawer UI is the
 * shared `@hanzo/canvas` primitive; this module owns only the DATA + auth + the
 * fold (`gitops/logic`) — one way, no bespoke canvas.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, GitBranch, RefreshCw, RotateCcw, Search } from '@hanzogui/lucide-icons-2'
import { useThemeSetting } from '@hanzogui/next-theme'
import { EnvSwitcher, ServiceDetailDrawer, type ServiceNodeData } from '@hanzo/canvas'

import { GitopsApi, type Application, type HealthStatus } from '~/lib/api/gitops'
import { GitApi } from '~/lib/api/git'
import { BuildsApi } from '~/lib/api/builds'
import { ApiError } from '~/lib/api'
import { Loader } from '~/components/ui/Loader'
import { SlideOver } from '~/components/ui/SlideOver'
import { useToast } from '~/components/ui/Toast'
import { SuperAdminRequired, ErrorState, asApiError, isForbidden, type HonestCopy } from '~/components/ui/States'
import { usePoll, useReducedMotion } from '../overview/living/hooks'
import { renderServiceIcon } from '../platform-apps/icons'
import { LazyProjectCanvas, CanvasFrame } from './canvas-lazy'
import { buildFleetTabs } from './drawer'
import {
  foldFleet,
  fleetNodeId,
  gridPositions,
  releaseTargets,
  repoBaseName,
  resolveApp,
  summarize,
  type FleetBuild,
  type FleetGit,
} from './logic'
import { toneColor, toneVar } from '~/components/ui/tone'
import { Z } from '~/lib/z'
import { EmptyState, FieldText, PageHeader } from '@hanzo/ui/product'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const COPY: HonestCopy = {
  notFound:
    'The CD read (GET /v1/deploy/applications over the operator App CRs) is not routed on this host yet. It appears once cloud binds the k8s reader for the deploy plane.',
  unauthorized:
    'The CD plane is a platform surface — sign in as a member of the reserved admin org (a normal org sees its own applications once the org-scoped projection lands).',
}

/** The health lenses the KPI band toggles (Out-of-sync is a sync lens). */
type Lens = 'all' | 'Healthy' | 'Progressing' | 'Degraded' | 'OutOfSync'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; apps: Application[]; gitByRepo: Map<string, FleetGit>; buildByRepo: Map<string, FleetBuild> }

/** One composite read: the fleet (fatal) + best-effort git + build enrichment. */
async function loadFleet(): Promise<{ apps: Application[]; gitByRepo: Map<string, FleetGit>; buildByRepo: Map<string, FleetBuild> }> {
  const [appsR, reposR, buildsR] = await Promise.allSettled([GitopsApi.applications(), GitApi.repos(), BuildsApi.list()])
  if (appsR.status === 'rejected') throw appsR.reason

  const gitByRepo = new Map<string, FleetGit>()
  if (reposR.status === 'fulfilled') {
    for (const r of reposR.value) {
      gitByRepo.set(r.name.toLowerCase(), { ref: `${r.org}/${r.name}`, branch: r.defaultBranch, head: r.head })
    }
  }
  const buildByRepo = new Map<string, FleetBuild>()
  if (buildsR.status === 'fulfilled') {
    // Keep the newest build per repo (the list is recent-first best-effort; compare times).
    for (const b of buildsR.value) {
      const key = repoBaseName(b.repo)
      if (!key) continue
      const started = Date.parse(b.startedAt) || 0
      const prev = buildByRepo.get(key)
      if (!prev || started >= (prev.startedAt ?? 0)) buildByRepo.set(key, { status: b.status, startedAt: started || undefined })
    }
  }
  return { apps: appsR.value, gitByRepo, buildByRepo }
}

function matchesLens(a: Application, lens: Lens): boolean {
  if (lens === 'all') return true
  const { health, sync } = resolveApp(a)
  if (lens === 'OutOfSync') return sync === 'OutOfSync'
  if (lens === 'Degraded') return health === 'Degraded' || health === 'Missing'
  return health === lens
}

export function GitOpsModule({ params }: { params: Record<string, string> }) {
  const reducedMotion = useReducedMotion()
  const { current, resolvedTheme } = useThemeSetting()
  const theme: 'light' | 'dark' = (resolvedTheme ?? current ?? 'dark') === 'light' ? 'light' : 'dark'
  const { tick, bump } = usePoll(20_000)
  const toast = useToast()

  const [state, setState] = useState<State>({ phase: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [env, setEnv] = useState('')
  const [lens, setLens] = useState<Lens>('all')
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState<string>(params.name ?? '')
  const [syncTarget, setSyncTarget] = useState<Application | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<Application | null>(null)

  useEffect(() => {
    let live = true
    setRefreshing(true)
    loadFleet()
      .then((data) => live && setState({ phase: 'ready', ...data }))
      .catch((e) => live && setState((s) => (s.phase === 'ready' ? s : { phase: 'error', err: asApiError(e) })))
      .finally(() => live && setRefreshing(false))
    return () => {
      live = false
    }
  }, [tick])

  const refresh = useCallback(() => bump(), [bump])

  const apps = state.phase === 'ready' ? state.apps : []
  const summary = useMemo(() => (state.phase === 'ready' ? summarize(apps) : null), [state, apps])

  const envOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of apps) {
      const e = a.env || ''
      if (e) counts.set(e, (counts.get(e) ?? 0) + 1)
    }
    return Array.from(counts, ([id, count]) => ({ id, label: id, count })).sort((x, y) => x.id.localeCompare(y.id))
  }, [apps])

  const visibleApps = useMemo(() => {
    const q = query.trim().toLowerCase()
    return apps.filter(
      (a) =>
        (!env || a.env === env) &&
        matchesLens(a, lens) &&
        (!q || a.name.toLowerCase().includes(q) || a.image.repository.toLowerCase().includes(q)),
    )
  }, [apps, env, lens, query])

  const nodes = useMemo(
    () => (state.phase === 'ready' ? foldFleet(visibleApps, { gitByRepo: state.gitByRepo, buildByRepo: state.buildByRepo }) : []),
    [state, visibleApps],
  )
  const positions = useMemo(() => gridPositions(nodes.map((n) => n.id)), [nodes])

  // node id → Application, for the drawer (the deep-link `:name` resolves too).
  const appByNode = useMemo(() => {
    const m = new Map<string, Application>()
    for (const a of apps) m.set(fleetNodeId(a), a)
    return m
  }, [apps])
  const appByName = useMemo(() => {
    const m = new Map<string, Application>()
    for (const a of apps) m.set(a.name, a)
    return m
  }, [apps])

  const selectedApp = selectedName ? appByName.get(selectedName) ?? null : null
  const selectedNode: ServiceNodeData | null = selectedApp
    ? nodes.find((n) => n.id === fleetNodeId(selectedApp)) ?? {
        id: fleetNodeId(selectedApp),
        name: selectedApp.name,
        kind: 'app',
        status: 'unknown',
      }
    : null

  const drawerTabs = useMemo(
    () => (selectedApp ? buildFleetTabs(selectedApp, { theme, reducedMotion }) : []),
    [selectedApp, theme, reducedMotion],
  )

  const empty = state.phase === 'ready' && apps.length === 0

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="Deploy"
        subtitle="The fleet on one live map — every operator App CR, its reconciled health, sync, resource topology, and one-click rollback. The Hanzo operator reconciles."
        actions={
          <XStack gap="$2" items="center" flexWrap="wrap">
            {envOptions.length > 1 ? (
              <EnvSwitcher size="sm" value={env} onChange={setEnv} options={[{ id: '', label: 'All envs' }, ...envOptions]} />
            ) : null}
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={refresh} disabled={refreshing}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {summary ? (
        <XStack gap="$2.5" flexWrap="wrap">
          <FilterStat label="Applications" value={summary.total} active={lens === 'all'} onPress={() => setLens('all')} />
          <FilterStat label="Healthy" value={summary.healthy} tone={toneVar('positive')} active={lens === 'Healthy'} onPress={() => setLens('Healthy')} />
          <FilterStat label="Progressing" value={summary.progressing} tone={toneVar('warning')} active={lens === 'Progressing'} onPress={() => setLens('Progressing')} />
          <FilterStat label="Degraded" value={summary.degraded} tone={toneVar('critical')} active={lens === 'Degraded'} onPress={() => setLens('Degraded')} />
          <FilterStat label="Out of sync" value={summary.outOfSync} tone={toneVar('warning')} active={lens === 'OutOfSync'} onPress={() => setLens('OutOfSync')} />
        </XStack>
      ) : null}

      {state.phase === 'ready' && apps.length > 0 ? (
        <XStack maxW={360} items="center" gap="$2">
          <Search size={15} color={toneColor('muted')} />
          <YStack flex={1}>
            <FieldText value={query} onChange={setQuery} placeholder="Filter by name or image repository…" />
          </YStack>
        </XStack>
      ) : null}

      {state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <SuperAdminRequired />
        ) : (
          <ErrorState err={state.err} onRetry={refresh} copy={COPY} />
        )
      ) : state.phase === 'loading' ? (
        <Loader label="Loading the fleet…" />
      ) : empty ? (
        <EmptyState
          icon={Boxes}
          title="No applications yet"
          description="Every operator App CR shows up here as a live service node on the deploy map — its declared image, reconciled health, resource topology, and one-click rollback. Deploy via the native pipeline (git push → image → CR) and it appears here."
          bullets={[
            'Source: the live operator CRs, read server-side by cloud (GET /v1/deploy/applications) — the console holds no cluster credentials.',
            'Rollback pins the CR image tag to a prior clean-semver release; the operator reconciles. No kubectl.',
          ]}
        />
      ) : (
        <CanvasFrame>
          {nodes.length > 0 ? (
            <LazyProjectCanvas
              nodes={nodes}
              positions={positions}
              theme={theme}
              reducedMotion={reducedMotion}
              renderIcon={renderServiceIcon}
              onOpenDetail={(n) => setSelectedName(appByNode.get(n.id)?.name ?? '')}
            />
          ) : (
            <ScopedEmpty
              onClear={() => {
                setEnv('')
                setLens('all')
                setQuery('')
              }}
            />
          )}
        </CanvasFrame>
      )}

      <ServiceDetailDrawer
        open={!!selectedApp}
        onClose={() => setSelectedName('')}
        service={selectedNode}
        tabs={drawerTabs}
        reducedMotion={reducedMotion}
        renderIcon={renderServiceIcon}
        headerActions={
          selectedApp ? (
            <XStack gap="$2" items="center" flexWrap="wrap">
              <Button size="$2" icon={<RotateCcw size={14} />} onPress={() => setRollbackTarget(selectedApp)}>
                Rollback
              </Button>
              <Button size="$2" icon={<RefreshCw size={14} />} onPress={() => setSyncTarget(selectedApp)}>
                Sync
              </Button>
            </XStack>
          ) : null
        }
      />

      <SyncConfirm app={syncTarget} onClose={() => setSyncTarget(null)} onDone={refresh} toast={toast} />
      <RollbackPanel app={rollbackTarget} onClose={() => setRollbackTarget(null)} onDone={refresh} toast={toast} />
    </YStack>
  )
}

/** A pressable KPI tile that doubles as the health filter (active = highlighted). */
function FilterStat({
  label,
  value,
  tone,
  active,
  onPress,
}: {
  label: string
  value: number
  tone?: string
  active?: boolean
  onPress: () => void
}) {
  return (
    <Card
      p="$3"
      gap="$1"
      minW={104}
      flex={1}
      borderWidth={1}
      borderColor={active ? '$color12' : '$borderColor'}
      bg={active ? '$color3' : '$color1'}
      hoverStyle={{ borderColor: '$color11' }}
      onPress={onPress}
      style={{ cursor: 'pointer' }}
    >
      <Text fontSize="$7" fontWeight="800" style={tone && value > 0 ? { color: tone } : undefined}>
        {value}
      </Text>
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
    </Card>
  )
}

/** When a filter hides everything, an honest in-canvas note. */
function ScopedEmpty({ onClear }: { onClear: () => void }) {
  return (
    <YStack flex={1} items="center" justify="center" gap="$3" p="$6" style={{ height: '100%' }}>
      <GitBranch size={28} color={toneColor('muted')} />
      <Text fontSize="$3" color="$color11">
        No applications in this filter.
      </Text>
      <Button size="$3" onPress={onClear}>
        Show all
      </Button>
    </YStack>
  )
}

// ── Confirm-gated actions (no accidental prod sync/rollback from a fat-finger) ──

type ToastApi = ReturnType<typeof useToast>

function SyncConfirm({ app, onClose, onDone, toast }: { app: Application | null; onClose: () => void; onDone: () => void; toast: ToastApi }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!app) return
    setBusy(true)
    try {
      await GitopsApi.sync(app.name)
      toast.success('Sync requested', `${app.name} → re-reconciling`)
      onClose()
      onDone()
    } catch (e) {
      const err = asApiError(e)
      toast.error(err.status === 404 ? 'Sync not available yet' : `${app.name} was not synced`, err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <SlideOver open={!!app} onClose={onClose} title={app ? `Sync ${app.name}` : 'Sync'} icon={RefreshCw} size={440} zIndex={Z.popover} ariaLabel="Sync application">
      {app ? (
        <YStack gap="$4">
          <Text fontSize="$3" color="$color11">
            Request an operator reconcile of <Text color="$color12" fontWeight="600">{app.name}</Text> now — the operator
            re-applies the desired Service CR to the cluster. This does not change the declared image.
          </Text>
          <XStack gap="$2" justify="flex-end">
            <Button size="$3" chromeless onPress={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={run} disabled={busy}>
              {busy ? 'Requesting…' : 'Sync now'}
            </Button>
          </XStack>
        </YStack>
      ) : null}
    </SlideOver>
  )
}

function RollbackPanel({ app, onClose, onDone, toast }: { app: Application | null; onClose: () => void; onDone: () => void; toast: ToastApi }) {
  const [targets, setTargets] = useState<string[] | undefined>(undefined)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!app) {
      setTargets(undefined)
      return
    }
    let live = true
    setTargets(undefined)
    const base = repoBaseName(app.image.repository)
    GitApi.refs(base)
      .then((r) => live && setTargets(releaseTargets(app.image.tag, r.tags.map((t) => t.name))))
      .catch(() => live && setTargets([]))
    return () => {
      live = false
    }
  }, [app])

  const rollback = async (tag: string) => {
    if (!app) return
    setBusy(tag)
    try {
      await GitopsApi.rollback(app.name, tag)
      toast.success('Rollback requested', `${app.name} → ${tag}`)
      onClose()
      onDone()
    } catch (e) {
      const err = asApiError(e)
      toast.error(err.status === 404 ? 'Rollback not available yet' : `${app.name} was not rolled back`, err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <SlideOver open={!!app} onClose={onClose} title={app ? `Roll back ${app.name}` : 'Roll back'} icon={RotateCcw} size={460} zIndex={Z.popover} ariaLabel="Roll back application">
      {app ? (
        <YStack gap="$3">
          <Text fontSize="$3" color="$color11">
            Currently at <Text style={{ fontFamily: MONO }} color="$color12">{app.image.tag || '—'}</Text>. Choosing a prior
            release pins the CR image tag and the operator reconciles the rollout — no kubectl. Only clean-semver git
            releases are offered.
          </Text>
          {targets === undefined ? (
            <Loader label="Loading releases…" />
          ) : targets.length === 0 ? (
            <Card borderWidth={1} borderColor="$borderColor" p="$4">
              <Text fontSize="$3" color="$color11">No prior clean-semver releases found for this application's repository.</Text>
            </Card>
          ) : (
            <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
              {targets.map((tag) => (
                <XStack key={tag} items="center" justify="space-between" gap="$3" px="$3" py="$2.5" borderBottomWidth={1} borderColor="$borderColor">
                  <Text fontSize="$3" color="$color12" style={{ fontFamily: MONO }}>
                    {tag}
                  </Text>
                  <Button size="$2" icon={<RotateCcw size={14} />} disabled={busy === tag} onPress={() => rollback(tag)}>
                    {busy === tag ? 'Rolling back…' : 'Roll back'}
                  </Button>
                </XStack>
              ))}
            </YStack>
          )}
        </YStack>
      ) : null}
    </SlideOver>
  )
}
