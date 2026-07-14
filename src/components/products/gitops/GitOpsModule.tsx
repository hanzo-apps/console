'use client'

/**
 * Hanzo GitOps — the console's native ArgoCD replacement.
 *
 * Renders the live `services.hanzo.ai` operator CRs (the ONE native pipeline:
 * git push → native Actions → image → registry → cloud emits/updates a Service
 * CR → hanzo-operator reconciles). The console holds NO cluster credentials; it
 * reads everything through cloud's `/v1/gitops/*` (SuperAdmin-gated server-side)
 * and never fabricates a row — a not-yet-live route renders an honest state.
 *
 * THIN by design. The rich ArgoCD-grade UI (interactive resource TOPOLOGY, the
 * desired-vs-live DIFF viewer, the streaming LOG viewer) is being ported into a
 * reusable `@hanzo/ui/gitops` export; this module owns the ROUTE + DATA WIRING +
 * AUTH and MOUNTS those components (see `ui-contract.ts`). Until that package
 * lands, the panels marked `MOUNT SEAM` render an honest interim over the SAME
 * fetched data (the applications board, an owned-resource inventory with real
 * health, rollout history, and logs) plus the actions (Rollback = patch the CR
 * tag → operator reconciles; Sync = force a re-reconcile).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import {
  ArrowLeft,
  Boxes,
  ChevronRight,
  GitBranch,
  History,
  Layers,
  RefreshCw,
  RotateCcw,
  ScrollText,
} from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import {
  GitopsApi,
  type Application,
  type AppTree,
  type LogLine,
  type ResourceNode,
} from '~/lib/api/gitops'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard, Panel } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { Loader } from '~/components/ui/Loader'
import { SlideOver } from '~/components/ui/SlideOver'
import { useToast } from '~/components/ui/Toast'
import { ErrorState, OperatorAccessRequired, asApiError, isForbidden, type HonestCopy } from '~/components/ui/States'
import { HealthPill, SyncPill } from './parts'
import { rollbackTargets, resourceHealth, resolveApp, summarize, treeHealth } from './logic'
import { GITOPS_UI_PACKAGE } from './ui-contract'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const COPY: HonestCopy = {
  notFound:
    'The GitOps read (GET /v1/gitops/applications over the operator CRs) is not routed on this host yet. It appears automatically once cloud binds the k8s reader for the services.hanzo.ai custom resources.',
  unauthorized:
    'This is a SuperAdmin platform surface. Access is enforced server-side by cloud — sign in as a member of the reserved admin org.',
}

// ── Applications board (the ArgoCD app list) ─────────────────────────────────

type BoardState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; apps: Application[] }

type Row = ReturnType<typeof toRow>
function toRow(app: Application) {
  const { health, sync } = resolveApp(app)
  return { app, health, sync, key: app.name }
}

function ApplicationsBoard({ onOpen }: { onOpen: (name: string) => void }) {
  const toast = useToast()
  const [state, setState] = useState<BoardState>({ phase: 'loading' })
  const [rollbackApp, setRollbackApp] = useState<Application | null>(null)
  const [syncing, setSyncing] = useState<string>('')

  const load = useCallback(() => {
    let cancelled = false
    setState({ phase: 'loading' })
    GitopsApi.applications()
      .then((apps) => !cancelled && setState({ phase: 'ready', apps }))
      .catch((e) => !cancelled && setState({ phase: 'error', err: asApiError(e) }))
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => load(), [load])

  const onSync = useCallback(
    async (app: Application) => {
      setSyncing(app.name)
      try {
        await GitopsApi.sync(app.name)
        toast.success('Sync requested', `${app.name} → re-reconciling`)
        load()
      } catch (e) {
        const err = asApiError(e)
        toast.error(err.status === 404 ? 'Sync not available yet' : 'Sync failed', err.message)
      } finally {
        setSyncing('')
      }
    },
    [toast, load],
  )

  const rows = useMemo(() => (state.phase === 'ready' ? state.apps.map(toRow) : []), [state])
  const summary = useMemo(() => (state.phase === 'ready' ? summarize(state.apps) : null), [state])

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Application',
      render: (r) => (
        <YStack gap="$0.5">
          <Text
            fontSize="$4"
            fontWeight="600"
            color="$color12"
            cursor="pointer"
            hoverStyle={{ color: '$blue10' }}
            onPress={() => onOpen(r.app.name)}
          >
            {r.app.name}
          </Text>
          <Text fontSize="$2" color="$color10" numberOfLines={1} style={{ fontFamily: MONO }}>
            {r.app.image.repository || r.app.namespace}
          </Text>
        </YStack>
      ),
    },
    { key: 'version', header: 'Version', width: 150, render: (r) => <Text fontSize="$3" color="$color12" style={{ fontFamily: MONO }}>{r.app.image.tag || '—'}</Text> },
    { key: 'health', header: 'Health', width: 150, render: (r) => <HealthPill health={r.health} /> },
    { key: 'sync', header: 'Sync', width: 140, render: (r) => <SyncPill sync={r.sync} /> },
    {
      key: 'actions',
      header: '',
      width: 250,
      align: 'right',
      render: (r) => (
        <XStack gap="$2" justify="flex-end" flexWrap="wrap">
          <Button
            size="$2"
            icon={<RotateCcw size={14} />}
            disabled={rollbackTargets(r.app).length === 0}
            onPress={() => setRollbackApp(r.app)}
          >
            Rollback
          </Button>
          <Button size="$2" icon={<RefreshCw size={14} />} disabled={syncing === r.app.name} onPress={() => onSync(r.app)}>
            Sync
          </Button>
          <Button size="$2" chromeless iconAfter={<ChevronRight size={14} />} onPress={() => onOpen(r.app.name)}>
            Open
          </Button>
        </XStack>
      ),
    },
  ]

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="GitOps"
        subtitle="The native deploy plane — every services.hanzo.ai operator CR, its live health, sync, and rollout. No ArgoCD; the hanzo-operator reconciles."
        actions={
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={load} disabled={state.phase === 'loading'}>
            Refresh
          </Button>
        }
      />

      {summary ? (
        <XStack gap="$3" flexWrap="wrap">
          <MetricCard icon={<Boxes size={16} />} label="Applications" value={String(summary.total)} caption={`${summary.healthy} healthy`} />
          <MetricCard icon={<RefreshCw size={16} />} label="Progressing" value={String(summary.progressing)} caption="rolling out" />
          <MetricCard icon={<GitBranch size={16} />} label="Degraded" value={String(summary.degraded)} caption="need attention" />
          <MetricCard icon={<RotateCcw size={16} />} label="Out of sync" value={String(summary.outOfSync)} caption={`${summary.synced} synced`} />
        </XStack>
      ) : null}

      {state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <OperatorAccessRequired />
        ) : (
          <ErrorState err={state.err} onRetry={load} copy={COPY} />
        )
      ) : state.phase === 'ready' && state.apps.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No applications yet"
          description="Every services.hanzo.ai operator CR shows up here as a GitOps application — its declared image, live health, sync status, and one-click rollback. Deploy via the native pipeline (git push → image → CR) and it appears here."
          bullets={[
            'Source: the live operator CRs, read server-side by cloud (GET /v1/gitops/applications) — the console holds no cluster credentials.',
            'Rollback patches the CR spec.image.tag; the operator reconciles the Deployment. No kubectl, no ArgoCD.',
          ]}
        />
      ) : (
        <DataTable columns={columns} rows={rows} loading={state.phase === 'loading'} rowKey={(r) => r.key} empty="No applications." />
      )}

      <RollbackPanel app={rollbackApp} onClose={() => setRollbackApp(null)} onDone={load} />
    </YStack>
  )
}

// ── Rollback panel (patch CR tag → operator reconciles) ──────────────────────

function RollbackPanel({ app, onClose, onDone }: { app: Application | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const targets = app ? rollbackTargets(app) : []

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
      toast.error(err.status === 404 ? 'Rollback not available yet' : 'Rollback failed', err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <SlideOver open={!!app} onClose={onClose} title={app ? `Roll back ${app.name}` : 'Roll back'} icon={RotateCcw} size={460}>
      {app ? (
        <YStack gap="$3">
          <Text fontSize="$3" color="$color11">
            Currently at <Text style={{ fontFamily: MONO }} color="$color12">{app.image.tag || '—'}</Text>. Choosing a prior
            revision patches the CR <Text style={{ fontFamily: MONO }}>spec.image.tag</Text> and the operator reconciles the
            Deployment — no kubectl.
          </Text>
          {targets.length === 0 ? (
            <Card borderWidth={1} borderColor="$borderColor" p="$4">
              <Text fontSize="$3" color="$color11">No prior revisions recorded for this application.</Text>
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

// ── Application detail (header + actions + resources + rollout + logs) ────────

function ApplicationDetail({ name, onBack }: { name: string; onBack: () => void }) {
  const toast = useToast()
  const [app, setApp] = useState<Application | null | undefined>(undefined)
  const [appErr, setAppErr] = useState<ApiError | null>(null)
  const [tree, setTree] = useState<AppTree | null>(null)
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(() => {
    let cancelled = false
    setApp(undefined)
    setAppErr(null)
    GitopsApi.applications()
      .then((apps) => !cancelled && setApp(apps.find((a) => a.name === name) ?? null))
      .catch((e) => {
        if (!cancelled) {
          setApp(null)
          setAppErr(asApiError(e))
        }
      })
    // The tree is a separate, best-effort read — a not-yet-live /tree never blanks the header.
    GitopsApi.tree(name)
      .then((t) => !cancelled && setTree(t))
      .catch(() => !cancelled && setTree(null))
    return () => {
      cancelled = true
    }
  }, [name])
  useEffect(() => load(), [load])

  const onSync = useCallback(async () => {
    setSyncing(true)
    try {
      await GitopsApi.sync(name)
      toast.success('Sync requested', `${name} → re-reconciling`)
      load()
    } catch (e) {
      const err = asApiError(e)
      toast.error(err.status === 404 ? 'Sync not available yet' : 'Sync failed', err.message)
    } finally {
      setSyncing(false)
    }
  }, [name, toast, load])

  const resolved = app ? resolveApp(app) : null

  return (
    <YStack gap="$4" p="$4">
      <XStack items="center" gap="$2">
        <Button size="$2" chromeless icon={<ArrowLeft size={16} />} onPress={onBack}>
          GitOps
        </Button>
        <Text color="$color10">/</Text>
        <Text fontSize="$3" color="$color11" style={{ fontFamily: MONO }}>
          {name}
        </Text>
      </XStack>

      {app === undefined ? (
        <Loader label="Loading application…" />
      ) : app === null ? (
        appErr && isForbidden(appErr) ? (
          <OperatorAccessRequired />
        ) : (
          <ErrorState err={appErr ?? new ApiError(`Application "${name}" not found`, 404)} onRetry={load} copy={COPY} />
        )
      ) : (
        <>
          <PageHeader
            title={app.name}
            subtitle={`${app.image.repository}:${app.image.tag} · ${app.namespace}${app.org ? ` · ${app.org}` : ''}`}
            actions={
              <XStack gap="$2" items="center" flexWrap="wrap">
                <Button size="$2" icon={<RotateCcw size={15} />} disabled={rollbackTargets(app).length === 0} onPress={() => setRollbackOpen(true)}>
                  Rollback
                </Button>
                <Button size="$2" icon={<RefreshCw size={15} />} disabled={syncing} onPress={onSync}>
                  Sync
                </Button>
                <Button size="$2" chromeless icon={<RefreshCw size={15} />} onPress={load}>
                  Refresh
                </Button>
              </XStack>
            }
          />

          <XStack gap="$4" items="center" flexWrap="wrap">
            {resolved ? <HealthPill health={resolved.health} /> : null}
            {resolved ? <SyncPill sync={resolved.sync} /> : null}
            <Text fontSize="$3" color="$color11">
              {app.readyReplicas}/{app.replicas} ready · phase {app.phase || '—'}
            </Text>
          </XStack>
          {app.message ? (
            <Text fontSize="$2" color="$color10">
              {app.message}
            </Text>
          ) : null}

          <XStack gap="$4" flexWrap="wrap" items="flex-start">
            <ResourcesPanel tree={tree} />
            <RolloutHistory app={app} onRollback={() => setRollbackOpen(true)} />
          </XStack>

          <LogsPanel name={name} />

          <RollbackPanel app={rollbackOpen ? app : null} onClose={() => setRollbackOpen(false)} onDone={load} />
        </>
      )}
    </YStack>
  )
}

// ── Owned-resource inventory (MOUNT SEAM: the @hanzo/ui/gitops topology graph) ─

const KIND_ICON: Record<string, typeof Layers> = {
  Service: Layers,
  Deployment: Boxes,
  StatefulSet: Boxes,
  DaemonSet: Boxes,
  ReplicaSet: Layers,
  Pod: Boxes,
  Ingress: GitBranch,
  ConfigMap: ScrollText,
  Secret: ScrollText,
}

function ResourcesPanel({ tree }: { tree: AppTree | null }) {
  const tally = tree ? treeHealth(tree) : null
  return (
    <Panel title="Resources" grow>
      {/*
        MOUNT SEAM — replace this honest inventory with the interactive topology:
          import { ApplicationTree } from '@hanzo/ui/gitops'
          <ApplicationTree tree={tree} loadResource={(ref) => GitopsApi.resource(name, ref)} />
        (see ui-contract.ts). `treeToGraph` in logic.ts already maps the raw tree
        into the @hanzo/canvas node/edge model that component renders.
      */}
      {!tree ? (
        <Text fontSize="$3" color="$color10">
          The owned-resource tree (GET /v1/gitops/{'{name}'}/tree) is not routed on this host yet — it lights up when cloud
          binds the reader. The interactive topology graph + manifest/diff drill-in mount {GITOPS_UI_PACKAGE} when it ships.
        </Text>
      ) : tree.nodes.length === 0 ? (
        <Text fontSize="$3" color="$color10">No owned resources reported.</Text>
      ) : (
        <YStack gap="$2">
          {tally ? (
            <Text fontSize="$2" color="$color10">
              {tree.nodes.length} resources · {tally.Healthy} healthy{tally.Degraded ? ` · ${tally.Degraded} degraded` : ''}
              {tally.Progressing ? ` · ${tally.Progressing} progressing` : ''}
            </Text>
          ) : null}
          <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
            {tree.nodes.map((n) => (
              <ResourceRow key={n.ref} node={n} />
            ))}
          </YStack>
        </YStack>
      )}
    </Panel>
  )
}

function ResourceRow({ node }: { node: ResourceNode }) {
  const Icon = KIND_ICON[node.kind] ?? Boxes
  const health = resourceHealth(node)
  return (
    <XStack items="center" gap="$2.5" px="$3" py="$2" borderBottomWidth={1} borderColor="$borderColor" flexWrap="wrap">
      <Icon size={15} color="#8b949e" />
      <YStack flex={1} minW={140} gap="$0.5">
        <Text fontSize="$3" color="$color12" numberOfLines={1}>
          {node.name}
        </Text>
        <Text fontSize="$1" color="$color10">
          {node.kind}
          {node.replicas > 0 ? ` · ${node.readyReplicas}/${node.replicas}` : ''}
        </Text>
      </YStack>
      <HealthPill health={health} />
    </XStack>
  )
}

// ── Rollout history ──────────────────────────────────────────────────────────

function RolloutHistory({ app, onRollback }: { app: Application; onRollback: () => void }) {
  const targets = rollbackTargets(app)
  return (
    <Panel title="Rollout history" grow right={<History size={15} color="#8b949e" />}>
      <YStack gap="$2">
        <XStack items="center" gap="$2">
          <YStack width={8} height={8} style={{ backgroundColor: '#3fb950', borderRadius: 999 }} />
          <Text fontSize="$3" color="$color12" style={{ fontFamily: MONO }}>
            {app.image.tag || '—'}
          </Text>
          <Text fontSize="$1" color="$color10">current</Text>
        </XStack>
        {targets.length === 0 ? (
          <Text fontSize="$2" color="$color10">No prior revisions recorded.</Text>
        ) : (
          targets.map((tag) => (
            <XStack key={tag} items="center" gap="$2">
              <YStack width={8} height={8} style={{ backgroundColor: '#6e7681', borderRadius: 999 }} />
              <Text fontSize="$3" color="$color11" style={{ fontFamily: MONO }} flex={1}>
                {tag}
              </Text>
            </XStack>
          ))
        )}
        {targets.length > 0 ? (
          <Button size="$2" self="flex-start" icon={<RotateCcw size={14} />} onPress={onRollback}>
            Roll back…
          </Button>
        ) : null}
      </YStack>
    </Panel>
  )
}

// ── Logs (MOUNT SEAM: the @hanzo/ui/gitops streaming LogViewer) ──────────────

function LogsPanel({ name }: { name: string }) {
  const [lines, setLines] = useState<LogLine[] | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setErr(null)
    GitopsApi.logs(name, { tail: 200 })
      .then(setLines)
      .catch((e) => setErr(asApiError(e)))
      .finally(() => setLoading(false))
  }, [name])
  useEffect(() => load(), [load])

  return (
    <Panel title="Logs" grow={false} right={<Button size="$1" chromeless icon={<RefreshCw size={13} />} onPress={load} disabled={loading} />}>
      {/*
        MOUNT SEAM — replace with the streaming viewer:
          import { LogViewer } from '@hanzo/ui/gitops'
          <LogViewer lines={lines} loading={loading} onRefresh={load} />
      */}
      {loading && !lines ? (
        <Loader label="Loading logs…" />
      ) : err ? (
        <Text fontSize="$2" color="$color10">
          {err.status === 404
            ? `Pod logs (GET /v1/gitops/${name}/logs) are not routed on this host yet — they stream here once cloud binds the reader.`
            : `Could not load logs: ${err.message}`}
        </Text>
      ) : lines && lines.length ? (
        <ScrollView style={{ maxHeight: 320 }}>
          <YStack gap="$0.5" p="$2" bg="$color1" rounded="$3">
            {lines.map((l, i) => (
              <Text key={i} fontSize="$2" color="$color11" style={{ fontFamily: MONO }}>
                {l.ts ? `${l.ts} ` : ''}
                {l.pod ? `[${l.pod}] ` : ''}
                {l.message}
              </Text>
            ))}
          </YStack>
        </ScrollView>
      ) : (
        <Text fontSize="$2" color="$color10">No log lines for this application.</Text>
      )}
    </Panel>
  )
}

// ── Router module (registry: '' board, ':name' detail) ───────────────────────

export function GitOpsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const name = params.name ?? ''
  if (name) return <ApplicationDetail name={name} onBack={() => router.push('/gitops')} />
  return <ApplicationsBoard onOpen={(n) => router.push(`/gitops/${encodeURIComponent(n)}`)} />
}
