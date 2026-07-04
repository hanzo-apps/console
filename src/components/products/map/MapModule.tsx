'use client'

/**
 * Map — the org's whole deployment landscape on one canvas: every app, managed
 * database, and domain as a live node, with the connections between them. The
 * console's other surfaces are LISTS; this is where you SEE what is running.
 *
 * ONE org-scoped read composes it: the per-org PaaS apps (`PaasApi.listAllApps`,
 * `/v1/platform`) + the seven managed data kinds (`ProvisioningApi`,
 * `/v1/<kind>`). The pure `buildGraph` folds them into nodes/edges (honest edges
 * only — see graph.ts), and the canvas renders it. Status refreshes on the shared
 * `usePoll` clock, silently (a poll never blanks a working canvas); a first-load
 * failure shows the honest `ErrorState`, an empty landscape the onboarding
 * `EmptyState` — never fabricated services.
 */
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowRight, ExternalLink, Gauge, Network, RefreshCw } from '@hanzogui/lucide-icons-2'

import { PaasApi, type PaasAppWithProject } from '~/lib/api/paas'
import { ProvisioningApi, type ResourceKind } from '~/lib/api/provisioning'
import { PageHeader } from '~/components/ui/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { ErrorState, asApiError } from '~/components/ui/States'
import { SlideOver } from '~/components/ui/SlideOver'
import { usePoll, useReducedMotion } from '~/components/products/overview/living/hooks'

import { buildGraph, summarize, type MapGraph, type MapNodeData, type ResourceWithKind } from './graph'
import { iconFor, kindLabel, productLabel, StatusDot } from './presentation'

/** The managed data kinds the provisioning service serves. */
const RESOURCE_KINDS: ResourceKind[] = ['sql', 'vector', 'kv', 'search', 's3', 'datastore', 'docdb']

/** Poll the landscape every 15s while the tab is visible. */
const POLL_MS = 15_000

// `@xyflow/react` is browser-only — load the canvas client-side so SSR/prerender
// never evaluates it.
const MapCanvas = dynamic(() => import('./MapCanvas'), { ssr: false, loading: () => <CanvasFrame><Loading /></CanvasFrame> })

type Data = { apps: PaasAppWithProject[]; resources: ResourceWithKind[] }
type State = { phase: 'loading' } | { phase: 'error'; error: ReturnType<typeof asApiError> } | { phase: 'ready'; data: Data }

/** One composite read: apps (fails → whole load fails) + resources (per-kind degrade to []). */
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

export function MapModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const { tick, bump } = usePoll(POLL_MS)
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<MapNodeData | null>(null)

  useEffect(() => {
    let live = true
    setRefreshing(true)
    loadLandscape()
      .then((data) => {
        if (live) setState({ phase: 'ready', data })
      })
      .catch((e) => {
        // A poll failure keeps the last good canvas; only a first-load failure surfaces.
        if (live) setState((s) => (s.phase === 'ready' ? s : { phase: 'error', error: asApiError(e) }))
      })
      .finally(() => {
        if (live) setRefreshing(false)
      })
    return () => {
      live = false
    }
  }, [tick])

  const graph: MapGraph | null = useMemo(
    () => (state.phase === 'ready' ? buildGraph(state.data) : null),
    [state],
  )
  const summary = useMemo(() => (graph ? summarize(graph) : null), [graph])
  const empty = state.phase === 'ready' && state.data.apps.length === 0 && state.data.resources.length === 0

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
          <Loading />
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
          <MapCanvas graph={graph!} reducedMotion={reducedMotion} onSelect={setSelected} />
        </CanvasFrame>
      )}

      <NodePanel node={selected} onClose={() => setSelected(null)} onNavigate={(href) => router.push(href)} />
    </YStack>
  )
}

/** The bordered canvas viewport — one definite height so the canvas can size itself. */
function CanvasFrame({ children }: { children: React.ReactNode }) {
  return (
    <Card
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$4"
      overflow="hidden"
      p={0}
      bg="$color1"
      style={{ height: 'min(74vh, 860px)', minHeight: 480 }}
    >
      {children}
    </Card>
  )
}

function Loading() {
  return (
    <YStack flex={1} items="center" justify="center" gap="$2" style={{ height: '100%' }}>
      <Spinner />
      <Text fontSize="$2" color="$color10">
        Mapping your landscape…
      </Text>
    </YStack>
  )
}

/** The tap-to-act detail rail: what the node is, its facts, and deep links out. */
function NodePanel({
  node,
  onClose,
  onNavigate,
}: {
  node: MapNodeData | null
  onClose: () => void
  onNavigate: (href: string) => void
}) {
  return (
    <SlideOver
      open={!!node}
      onClose={onClose}
      title={node?.label ?? ''}
      icon={node ? iconFor(node) : undefined}
      size={420}
      ariaLabel="Node details"
    >
      {node ? (
        <YStack gap="$4">
          <XStack items="center" gap="$2">
            <StatusDot status={node.status} />
            <Text fontSize="$3" color="$color12" fontWeight="600">
              {node.rawStatus || node.status}
            </Text>
            <Text fontSize="$2" color="$color10">
              · {kindLabel(node.kind)}
            </Text>
          </XStack>

          <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$1.5">
            {node.detail.map((d) => (
              <XStack key={d.label} justify="space-between" gap="$3" items="flex-start">
                <Text fontSize="$2" color="$color10">
                  {d.label}
                </Text>
                <Text fontSize="$2" color="$color12" numberOfLines={1} style={{ maxWidth: 250, textAlign: 'right' }}>
                  {d.value}
                </Text>
              </XStack>
            ))}
          </Card>

          <YStack gap="$2">
            <Button icon={<ArrowRight size={15} />} onPress={() => onNavigate(`/${node.productId}`)}>
              Open {productLabel(node.productId)}
            </Button>
            <Button theme="light" icon={<Gauge size={15} />} onPress={() => onNavigate(`/${node.productId}/metrics`)}>
              Observability
            </Button>
            {node.href ? (
              <Button
                chromeless
                iconAfter={<ExternalLink size={14} />}
                onPress={() => {
                  if (typeof window !== 'undefined') window.open(node.href, '_blank', 'noopener')
                }}
              >
                Open site
              </Button>
            ) : null}
          </YStack>
        </YStack>
      ) : null}
    </SlideOver>
  )
}
