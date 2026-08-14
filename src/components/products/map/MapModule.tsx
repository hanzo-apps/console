'use client'

/**
 * Map — the org's whole deployment landscape on one canvas: every app, managed
 * database, and domain as a live node, with the honest connections between them.
 * The console's other surfaces are LISTS; this is where you SEE what is running.
 *
 * ONE org-scoped read composes it: the per-org PaaS apps (`PaasApi.listAllApps`,
 * `/v1/platform`) + the managed data kinds (`ProvisioningApi`, `/v1/<kind>`). The
 * pure `buildGraph` folds them into an honest node/edge graph (graph.ts), a thin
 * adapter maps that into the generic `@hanzo/canvas` model, and the SAME
 * `ProjectCanvas`/`ServiceDetailDrawer` the App Platform uses renders it — one
 * canvas implementation, reused. Status refreshes on the shared `usePoll` clock;
 * a poll never blanks a working canvas, a first-load failure shows `ErrorState`,
 * an empty landscape the onboarding `EmptyState` — never fabricated services.
 */
import { useMemo, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowRight, ExternalLink, Gauge, Network, RefreshCw } from '@hanzogui/lucide-icons-2'
import { useThemeSetting } from '@hanzogui/next-theme'
import { ServiceDetailDrawer, type DrawerTab, type ServiceEdgeData, type ServiceKind, type ServiceNodeData, type ServiceStatus } from '@hanzo/canvas'

import { PaasApi, type PaasAppWithProject } from '~/lib/api/paas'
import { ProvisioningApi, type ResourceKind } from '~/lib/api/provisioning'
import { ErrorState, asApiError } from '~/components/ui/States'
import { Loader } from '~/components/ui/Loader'
import { usePoll, useReducedMotion } from '~/components/products/overview/living/hooks'
import { capabilityFor } from '~/lib/products/subsystems'
import { renderServiceIcon } from '~/components/products/platform-apps/icons'
import { buildGraph, summarize, type MapGraph, type MapNodeData, type NodeStatus, type ResourceWithKind } from './graph'
import { EmptyState, PageHeader } from '@hanzo/ui/product'

const RESOURCE_KINDS: ResourceKind[] = ['sql', 'vector', 'kv', 'search', 's3', 'datastore', 'docdb']
const POLL_MS = 15_000

const ProjectCanvas = dynamic(() => import('@hanzo/canvas').then((m) => m.ProjectCanvas), {
  ssr: false,
  loading: () => <CanvasFrame><Loader label="Mapping your landscape…" /></CanvasFrame>,
})

type Data = { apps: PaasAppWithProject[]; resources: ResourceWithKind[] }
type State = { phase: 'loading' } | { phase: 'error'; error: ReturnType<typeof asApiError> } | { phase: 'ready'; data: Data }

async function loadLandscape(): Promise<Data> {
  const apps = await PaasApi.listAllApps()
  const lists = await Promise.all(
    RESOURCE_KINDS.map((kind) =>
      ProvisioningApi.list(kind)
        .then((rs) => rs.map((r): ResourceWithKind => ({ ...r, kind })))
        .catch(() => [] as ResourceWithKind[]),
    ),
  )
  return { apps, resources: lists.flat() }
}

// ── graph.ts MapGraph → @hanzo/canvas model (one node card renders every tier) ──
const STATUS_MAP: Record<NodeStatus, ServiceStatus> = { ok: 'active', building: 'deploying', error: 'crashed', idle: 'sleeping' }
const RES_KIND: Record<string, ServiceKind> = { sql: 'database', datastore: 'database', docdb: 'database', vector: 'vector', kv: 'cache', search: 'search', s3: 'storage' }
const PRODUCT_LABEL: Record<string, string> = {
  'app-platform': 'App Platform', applications: 'Applications', sql: 'SQL', vector: 'Vector', kv: 'KV', search: 'Search', s3: 'S3', datastore: 'Datastore', docdb: 'DocDB',
}
const productLabel = (id: string): string => PRODUCT_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1)

function kindOf(d: MapNodeData): ServiceKind {
  if (d.kind === 'domain') return 'domain'
  if (d.kind === 'app') return 'app'
  return (d.resourceKind && RES_KIND[d.resourceKind]) || 'database'
}

function toCanvas(graph: MapGraph): { nodes: ServiceNodeData[]; edges: ServiceEdgeData[] } {
  const nodes: ServiceNodeData[] = graph.nodes.map((n) => {
    const d = n.data
    return {
      id: n.id,
      name: d.label,
      kind: kindOf(d),
      status: STATUS_MAP[d.status],
      statusLabel: d.rawStatus,
      typeLabel: d.kind === 'app' ? 'App' : d.kind === 'domain' ? 'Domain' : d.fact,
      capability: d.resourceKind ? capabilityFor(d.resourceKind) ?? undefined : d.kind === 'app' ? capabilityFor('platform') ?? undefined : undefined,
      href: `/${d.productId}`,
      externalHref: d.href,
    }
  })
  const edges: ServiceEdgeData[] = graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, reason: e.reason }))
  return { nodes, edges }
}

export function MapModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const { current, resolvedTheme } = useThemeSetting()
  const theme: 'light' | 'dark' = (resolvedTheme ?? current ?? 'dark') === 'light' ? 'light' : 'dark'
  const { tick, bump } = usePoll(POLL_MS)
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setRefreshing(true)
    loadLandscape()
      .then((data) => live && setState({ phase: 'ready', data }))
      .catch((e) => live && setState((s) => (s.phase === 'ready' ? s : { phase: 'error', error: asApiError(e) })))
      .finally(() => live && setRefreshing(false))
    return () => {
      live = false
    }
  }, [tick])

  const graph: MapGraph | null = useMemo(() => (state.phase === 'ready' ? buildGraph(state.data) : null), [state])
  const model = useMemo(() => (graph ? toCanvas(graph) : null), [graph])
  const dataById = useMemo(() => {
    const m = new Map<string, MapNodeData>()
    for (const n of graph?.nodes ?? []) m.set(n.id, n.data)
    return m
  }, [graph])
  const summary = useMemo(() => (graph ? summarize(graph) : null), [graph])
  const empty = state.phase === 'ready' && state.data.apps.length === 0 && state.data.resources.length === 0

  const selected: ServiceNodeData | null = useMemo(
    () => (selectedId && model ? model.nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, model],
  )

  const tabs: DrawerTab[] = useMemo(() => {
    if (!selected) return []
    const d = dataById.get(selected.id)
    return [
      {
        id: 'overview',
        label: 'Overview',
        content: (
          <YStack gap="$3">
            <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$1.5">
              {(d?.detail ?? []).map((row) => (
                <XStack key={row.label} justify="space-between" gap="$3" items="flex-start">
                  <Text fontSize="$2" color="$color10">
                    {row.label}
                  </Text>
                  <Text fontSize="$2" color="$color12" numberOfLines={1} style={{ maxWidth: 260, textAlign: 'right' }}>
                    {row.value}
                  </Text>
                </XStack>
              ))}
            </Card>
            <YStack gap="$2">
              <Button icon={<ArrowRight size={15} />} onPress={() => router.push(selected.href ?? '/')}>
                Open {productLabel(d?.productId ?? '')}
              </Button>
              <Button theme="light" icon={<Gauge size={15} />} onPress={() => router.push(`${selected.href ?? ''}/metrics`)}>
                Observability
              </Button>
              {selected.externalHref ? (
                <Button chromeless iconAfter={<ExternalLink size={14} />} onPress={() => typeof window !== 'undefined' && window.open(selected.externalHref, '_blank', 'noopener')}>
                  Open site
                </Button>
              ) : null}
            </YStack>
          </YStack>
        ),
      },
    ]
  }, [selected, dataById, router])

  return (
    <YStack gap="$4">
      <PageHeader
        title="Map"
        subtitle="Every app, database, and domain in your org — one live canvas."
        actions={
          <XStack gap="$3" items="center" flexWrap="wrap">
            {summary ? (
              <Text fontSize="$2" color="$color10">
                {summary.apps} apps · {summary.resources} data · {summary.domains} domains
              </Text>
            ) : null}
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={bump} disabled={refreshing}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state.phase === 'loading' ? (
        <CanvasFrame>
          <Loader label="Mapping your landscape…" />
        </CanvasFrame>
      ) : state.phase === 'error' ? (
        <ErrorState
          err={state.error}
          onRetry={bump}
          copy={{
            notFound:
              'The platform API is not routed on this host yet. Your deployment landscape appears here automatically once it is proxied through the gateway.',
          }}
        />
      ) : empty ? (
        <EmptyState
          icon={Network}
          title="Nothing deployed yet"
          description="Deploy your first app and it — with its domains and managed data — shows up here as a live map you can pan and zoom."
          bullets={[
            'Apps, managed databases, and domains render as connected nodes.',
            'Status updates live as things build, deploy, and go online.',
            'Click any node to jump straight to its product page.',
          ]}
          primary={{ label: 'Create an app', onPress: () => router.push('/app-platform') }}
          secondary={{ label: 'Docs', href: 'https://docs.hanzo.ai/docs' }}
        />
      ) : (
        <CanvasFrame>
          {model ? (
            <ProjectCanvas
              nodes={model.nodes}
              edges={model.edges}
              theme={theme}
              reducedMotion={reducedMotion}
              renderIcon={renderServiceIcon}
              onOpenDetail={(n) => setSelectedId(n.id)}
            />
          ) : null}
        </CanvasFrame>
      )}

      <ServiceDetailDrawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        service={selected}
        tabs={tabs}
        width={420}
        reducedMotion={reducedMotion}
        renderIcon={renderServiceIcon}
      />
    </YStack>
  )
}

/** The bordered canvas viewport — one definite height so the canvas can size itself. */
function CanvasFrame({ children }: { children: React.ReactNode }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden" p={0} bg="$color1" style={{ height: 'min(74vh, 860px)', minHeight: 480 }}>
      {children}
    </Card>
  )
}
