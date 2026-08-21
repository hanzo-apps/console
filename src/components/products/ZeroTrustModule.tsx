'use client'

/**
 * Zero Trust — the operational landing for private, identity-aware service
 * access, secured end-to-end by post-quantum transport (Hanzo zap).
 *
 * The Overview composes the REAL `/v1/network/*` fabric into a cloud-console
 * dashboard: KPI cards (routers / services), the post-quantum posture
 * (S3 ⇄ ZT data plane), and a router→service topology strip. Every number is a
 * real count or an honest em-dash; the topology shows only nodes that came back;
 * the posture is a true statement of the platform transport, not telemetry. When
 * the fabric isn't reachable from this host, the mesh sections degrade to one
 * honest BackendStateCard while the posture (a platform capability) still shows.
 *
 * The detail tabs reuse the SAME `zeroTrustSurfaces` + `ForwardSurface` tables
 * (DRY) — this module only adds the Overview landing on top and owns the routing.
 * Registry: `''` → Overview, `:tab` → overview|services|routers.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { Fragment } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  ShieldCheck,
  Waypoints,
  Server,
  RefreshCw,
  Lock,
  ArrowLeftRight,
  ArrowRight,
  HardDrive,
  KeyRound,
} from '@hanzogui/lucide-icons-2'

import { restGet, v1Url } from '~/lib/api/client'
import { ForwardSurface, zeroTrustSurfaces } from '~/components/products/ConsoleFeatureModule'
import {
  ZT_SECTION_IDS,
  ZT_ENDPOINT,
  POSTURE,
  emptySections,
  type ZtSections,
  type ZtNode,
  type ZtNodeKind,
  type ZtPosture,
  type Row,
  sectionCount,
  allSectionsDown,
  deriveTopology,
  topologyIsEmpty,
  liveCount,
} from '~/components/products/zt/logic'
import { toneVar } from '~/components/ui/tone'
import { BackendStateCard, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

type LucideIcon = typeof Waypoints

// Status → dot weight (the chrome is monochrome — emphasis, never hue). Live reads
// nominal; an explicit degraded/down status is emphasised; anything else stays muted
// (we never invent a "degraded" state).
const dotColor = (status?: string): string => {
  const st = (status ?? '').toLowerCase()
  if (['active', 'online', 'healthy', 'up', 'connected', 'ready', 'available'].includes(st)) return toneVar('positive')
  if (['degraded', 'warning', 'pending', 'connecting'].includes(st)) return toneVar('warning')
  if (['down', 'error', 'failed', 'offline', 'revoked'].includes(st)) return toneVar('critical')
  return toneVar('muted')
}

function Dot({ color }: { color: string }) {
  return <div style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: color, flexShrink: 0 }} />
}

// ── KPI card — MetricCard's visual language, minus the trend (we have no honest
//    time series for a count, and Sparkline would refuse to draw one anyway).
function StatCard({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub?: string }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" flex={1} minW={172}>
      <XStack items="center" gap="$2">
        <Icon size={15} opacity={0.7} />
        <Text fontSize="$2" color="$color10">
          {label}
        </Text>
      </XStack>
      <Text fontSize="$9" fontWeight="900" color="$color12">
        {value}
      </Text>
      <Text fontSize="$1" color="$color10">
        {sub ?? ' '}
      </Text>
    </Card>
  )
}

function PostureRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <XStack justify="space-between" items="center" py="$2" gap="$3" borderBottomWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$2">
        <Icon size={14} opacity={0.7} />
        <Text fontSize="$3" color="$color11" fontWeight="600">
          {label}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color12" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

function PostureCard({ posture }: { posture: ZtPosture }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" flex={1} minW={300}>
      <XStack items="center" gap="$2">
        <ShieldCheck size={16} />
        <Text fontSize="$5" fontWeight="800" color="$color12">
          Post-quantum posture
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        Hanzo zap encrypts traffic across the mesh with NIST post-quantum algorithms. Data captured on the
        wire today stays unreadable to a quantum computer built later.
      </Text>
      <YStack>
        <PostureRow icon={KeyRound} label="Key exchange" value={posture.kem} />
        <PostureRow icon={Lock} label="Signatures" value={posture.sig} />
        <PostureRow icon={ArrowLeftRight} label="Transport" value={posture.transport} />
        <PostureRow icon={HardDrive} label="Data plane" value="S3 ⇄ Zero Trust" />
      </YStack>
    </Card>
  )
}

const TOPOLOGY_COLUMNS: { kind: ZtNodeKind; label: string; icon: LucideIcon }[] = [
  { kind: 'router', label: 'Routers', icon: Waypoints },
  { kind: 'service', label: 'Services', icon: Server },
]

function NodeChip({ node }: { node: ZtNode }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$2.5" gap="$1">
      <XStack items="center" gap="$2">
        <Dot color={dotColor(node.status)} />
        <Text fontSize="$3" color="$color12" numberOfLines={1} flex={1}>
          {node.name}
        </Text>
      </XStack>
      {node.status ? (
        <Text fontSize="$1" color="$color10">
          {node.status}
        </Text>
      ) : null}
    </Card>
  )
}

function TopologyStrip({ topo }: { topo: Record<ZtNodeKind, ZtNode[]> }) {
  return (
    <XStack gap="$3" items="stretch" flexWrap="wrap">
      {TOPOLOGY_COLUMNS.map((col, ci) => (
        <Fragment key={col.kind}>
          <YStack flex={1} minW={188} gap="$2">
            <XStack items="center" gap="$2">
              <col.icon size={14} opacity={0.7} />
              <Text fontSize="$2" color="$color10" flex={1}>
                {col.label}
              </Text>
              <Text fontSize="$1" color="$color10">
                {topo[col.kind].length}
              </Text>
            </XStack>
            {topo[col.kind].length === 0 ? (
              <Card borderWidth={1} borderColor="$borderColor" p="$3">
                <Text fontSize="$2" color="$color10">
                  None
                </Text>
              </Card>
            ) : (
              topo[col.kind].map((n) => <NodeChip key={n.id} node={n} />)
            )}
          </YStack>
          {ci < TOPOLOGY_COLUMNS.length - 1 ? (
            <YStack justify="center" items="center" minW={18}>
              <ArrowRight size={16} opacity={0.4} />
            </YStack>
          ) : null}
        </Fragment>
      ))}
    </XStack>
  )
}

/** Fetch both fabric sections in parallel; each errors independently (honest). */
function useZtSections() {
  const [sections, setSections] = useState<ZtSections | null>(null)
  const [error, setError] = useState<BackendState | null>(null)

  const load = useCallback(() => {
    setSections(null)
    setError(null)
    void Promise.allSettled(ZT_SECTION_IDS.map((id) => restGet<unknown>(v1Url(ZT_ENDPOINT[id])))).then((settled) => {
      const next: ZtSections = { ...emptySections }
      let firstErr: BackendState | null = null
      ZT_SECTION_IDS.forEach((id, i) => {
        const r = settled[i]
        if (r.status === 'fulfilled') next[id] = asRows(r.value)
        else if (!firstErr) firstErr = classifyBackend(r.reason)
      })
      setSections(next)
      setError(firstErr)
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { sections, error, reload: load }
}

/** Normalize a `/v1/network/*` payload to rows: array, or the first array field, or []. */
function asRows(payload: unknown): Row[] {
  if (Array.isArray(payload)) return payload.filter((x): x is Row => Boolean(x) && typeof x === 'object')
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const k of ['data', 'rows', 'items', 'results', 'services', 'routers']) {
      const v = obj[k]
      if (Array.isArray(v)) return v.filter((x): x is Row => Boolean(x) && typeof x === 'object')
    }
  }
  return []
}

function ZtOverview() {
  const { sections, error, reload } = useZtSections()
  const loading = sections === null
  const s = sections ?? emptySections
  const topo = deriveTopology(s)
  const down = !loading && allSectionsDown(s)

  const val = (n: number | null): string => (loading ? '…' : n === null ? '—' : String(n))
  const activeSub = (rows: Row[] | null): string | undefined =>
    loading || rows === null ? undefined : `${liveCount(rows)} active`

  const kpis: { icon: LucideIcon; label: string; n: number | null; sub?: string }[] = [
    { icon: Waypoints, label: 'Routers', n: sectionCount(s.routers), sub: activeSub(s.routers) },
    { icon: Server, label: 'Services', n: sectionCount(s.services), sub: activeSub(s.services) },
  ]

  return (
    <YStack gap="$3">
      <XStack flexWrap="wrap" gap="$3">
        {kpis.map((k) => (
          <StatCard key={k.label} icon={k.icon} label={k.label} value={val(k.n)} sub={k.sub} />
        ))}
      </XStack>

      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <PostureCard posture={POSTURE} />
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" flex={1.6} minW={320}>
          <XStack items="center" gap="$2">
            <Waypoints size={16} />
            <Text fontSize="$5" fontWeight="800" color="$color12">
              Mesh topology
            </Text>
          </XStack>
          {loading ? (
            <Text fontSize="$3" color="$color10">
              Loading…
            </Text>
          ) : topologyIsEmpty(topo) ? (
            <Text fontSize="$3" color="$color10">
              No routers or services yet. Enroll a router, then define a service for it to reach.
              Each connection the mesh makes authenticates both ends before it carries anything.
            </Text>
          ) : (
            <TopologyStrip topo={topo} />
          )}
        </Card>
      </XStack>

      {down ? (
        <BackendStateCard
          state={error ?? { kind: 'unavailable', message: '' }}
          onRetry={reload}
          hint="Zero Trust mesh data arrives when the fabric has routers on it (GET /v1/network/*). The post-quantum posture above is the platform transport and applies regardless."
        />
      ) : null}
    </YStack>
  )
}

export function ZeroTrustModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const active = productSubpageSlug('zero-trust', params.tab) || 'overview'
  const detail = zeroTrustSurfaces.find((surface) => surface.id === active)

  return (
    <>
      <PageHeader
        title="Zero Trust"
        subtitle="Reach a private service without putting it on the public internet. Both ends prove who they are before any traffic moves."
        actions={
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => router.refresh()}>
            Refresh
          </Button>
        }
      />
      <SubNav id="zero-trust" />
      {active === 'overview' ? <ZtOverview /> : detail ? <ForwardSurface surface={detail} /> : null}
    </>
  )
}
