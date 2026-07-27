'use client'

/**
 * Lux Network — the console.lux.cloud SuperAdmin infrastructure board (the Lux
 * investor view of the REAL luxd + lux-k8s fleet). Three panels, every number a fold
 * over what VictoriaMetrics returns through the SuperAdmin-gated, allowlisted cloud VM
 * proxy (LuxInfraApi → /v1/o11y/vm/query): validators, node/pod memory pressure, and
 * the named-service status grid. Nothing is fabricated — an absent metric is an
 * em-dash or an honest null, never a green dot.
 *
 * Gated twice, like the fleet o11y board: the catalog entry is `admin: true` +
 * `brands: ['lux']` (hidden from every customer and every non-Lux console), and this
 * module renders OperatorAccessRequired for a non-SuperAdmin client. The cloud VM
 * proxy is the authoritative server gate (admin(c) + the fixed allowlist).
 *
 * Honest uptime: there is NO uptime metric in the hub, and the luxd on-chain uptime
 * TRACKER is currently stuck at 0.0000 (a known bug, fix gated) — so this board never
 * shows an uptime %. Per-validator liveness is derived from the LIVE up / peers /
 * height / bootstrapped signals, and the panel says so.
 *
 * White-label: `lux_*` series are Lux's own (brand=lux, cluster=lux-k8s) and the grid
 * keys on the Lux-branded SERVICE name, never a namespace — so no foreign brand string
 * reaches this surface. Rendered Lux-branded by host (config.brandName = "Lux Cloud").
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, Boxes, CheckCircle2, Coins, Cpu, Gauge, HardDrive, Network, RefreshCw, Server, TriangleAlert, Waypoints, XCircle } from '@hanzogui/lucide-icons-2'

import { LuxInfraApi, COMING_SOON_NETWORKS, type LuxInfra, type Liveness, type NetworkSummary, type ServiceStatus, type ValidatorRow } from '~/lib/api/lux-infra'
import { ApiError } from '~/lib/api'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard, Panel, UtilBar, utilColor } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { OperatorAccessRequired } from '~/components/ui/States'

// Lux primary-network staking facts (mainnet): 5 validators, each bonds 500M LUX →
// 2.5B LUX staked. Displayed as a caption on the primary panel (investor context).
const PRIMARY_BOND_LUX = '500M'
const PRIMARY_STAKED_LUX = '2.5B'

const intFmt = new Intl.NumberFormat('en-US')
const nOrDash = (v: number | null): string => (v === null ? '—' : intFmt.format(v))
const pct1 = (v: number): string => `${v.toFixed(1)}%`
const gib = (bytes: number): string => {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GiB`
  return `${Math.round(bytes / (1 << 20))} MiB`
}

type State = { phase: 'loading' } | { phase: 'error'; status: number; message: string } | { phase: 'ready'; data: LuxInfra }

export function LuxNetworkModule(_props: { params: Record<string, string> }) {
  const isSuperAdmin = useIsSuperAdmin()
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    LuxInfraApi.load()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) =>
        setState({
          phase: 'error',
          status: e instanceof ApiError ? e.status : 0,
          message: e instanceof Error ? e.message : String(e),
        }),
      )
  }, [])

  useEffect(() => {
    if (isSuperAdmin) load()
  }, [isSuperAdmin, load])

  // Client gate — the authoritative one is the cloud VM proxy (admin(c)); this is the
  // honest UI twin, so a non-SuperAdmin never sees a broken board.
  if (!isSuperAdmin) return <OperatorAccessRequired />

  return (
    <>
      <PageHeader
        title="Lux Network"
        subtitle="Live validator, node, and service health across the Lux fleet — real telemetry, nothing fabricated."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Reading Lux telemetry…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        <LuxError status={state.status} message={state.message} onRetry={load} />
      ) : (
        <Ready data={state.data} />
      )}
    </>
  )
}

function Ready({ data }: { data: LuxInfra }) {
  const primary = data.networks.find((n) => n.primary) ?? null
  const nodesOom = data.nodes.filter((n) => n.pct >= 85).length
  const servicesDeployed = data.services.filter((s) => s.deployed)
  const servicesHealthy = servicesDeployed.filter((s) => s.healthy).length

  return (
    <YStack gap="$4" maxW={1200} width="100%">
      {/* KPI band — folded from the real series. */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard
          icon={<Waypoints size={16} />}
          label="Primary validators up"
          value={primary ? `${nOrDash(primary.up)} / ${nOrDash(primary.total)}` : '—'}
          caption={primary ? `${PRIMARY_STAKED_LUX} LUX staked · ${PRIMARY_BOND_LUX} each` : 'mainnet'}
        />
        <MetricCard icon={<Network size={16} />} label="Networks" value={String(data.networks.length)} caption="reporting validators" />
        <MetricCard
          icon={<Server size={16} />}
          label="Nodes"
          value={String(data.nodes.length)}
          caption={nodesOom > 0 ? `${nodesOom} under memory pressure` : 'memory nominal'}
        />
        <MetricCard
          icon={<Boxes size={16} />}
          label="Services healthy"
          value={`${servicesHealthy} / ${servicesDeployed.length}`}
          caption="named Lux services"
        />
      </XStack>

      {/* ── Validators ─────────────────────────────────────────────────────── */}
      <YStack gap="$2">
        <XStack items="center" gap="$2">
          <Waypoints size={18} />
          <Text fontSize="$6" fontWeight="800">
            Validators
          </Text>
        </XStack>
        <UptimeNote />
        {data.networks.length === 0 ? (
          <Panel title="No validator telemetry" grow={false}>
            <Text fontSize="$3" color="$color10">
              No luxd validator series are reporting into the telemetry hub right now.
            </Text>
          </Panel>
        ) : (
          <YStack gap="$3">
            {data.networks.map((net) => (
              <NetworkPanel key={net.id} net={net} />
            ))}
          </YStack>
        )}
        <ComingSoonNetworks />
      </YStack>

      {/* ── Infrastructure: node + pod memory ──────────────────────────────── */}
      <YStack gap="$2">
        <XStack items="center" gap="$2">
          <Cpu size={18} />
          <Text fontSize="$6" fontWeight="800">
            Infrastructure
          </Text>
        </XStack>
        <XStack gap="$4" flexWrap="wrap">
          <Panel title="Node memory used" minW={340}>
            {data.nodes.length === 0 ? (
              <Text fontSize="$3" color="$color10">
                No node memory series reporting.
              </Text>
            ) : (
              <YStack gap="$2.5">
                {data.nodes.map((n) => (
                  <XStack key={n.node} items="center" gap="$3" justify="space-between">
                    <Text fontSize="$2" color="$color11" numberOfLines={1} flex={1} minW={0}>
                      {n.node}
                    </Text>
                    <UtilBar value={n.pct} width={120} />
                    <Text fontSize="$2" color="$color12" className="hz-mono" width={56} text="right">
                      {pct1(n.pct)}
                    </Text>
                  </XStack>
                ))}
              </YStack>
            )}
          </Panel>
          <Panel title="Top pods by memory" minW={340}>
            {data.pods.length === 0 ? (
              <Text fontSize="$3" color="$color10">
                No pod memory series reporting.
              </Text>
            ) : (
              <YStack gap="$2">
                {data.pods.map((p) => (
                  <XStack key={`${p.namespace}/${p.pod}`} items="center" gap="$3" justify="space-between">
                    <XStack items="center" gap="$2" flex={1} minW={0}>
                      <HardDrive size={13} color="$color10" />
                      <Text fontSize="$2" color="$color12" numberOfLines={1}>
                        {p.pod}
                      </Text>
                    </XStack>
                    <Text fontSize="$2" color="$color11" className="hz-mono" width={80} text="right">
                      {gib(p.bytes)}
                    </Text>
                  </XStack>
                ))}
              </YStack>
            )}
          </Panel>
        </XStack>
      </YStack>

      {/* ── Services status grid ───────────────────────────────────────────── */}
      <YStack gap="$2">
        <XStack items="center" gap="$2">
          <Activity size={18} />
          <Text fontSize="$6" fontWeight="800">
            Services
          </Text>
        </XStack>
        <ServiceGrid rows={data.services} />
      </YStack>
    </YStack>
  )
}

/** The honest on-chain-uptime disclaimer (the tracker bug the CTO flagged). */
function UptimeNote() {
  return (
    <Card borderWidth={1} borderColor="$borderColor" bg="$color2" p="$3" gap="$1.5">
      <XStack items="center" gap="$2">
        <TriangleAlert size={15} color="$yellow10" />
        <Text fontSize="$3" fontWeight="700">
          On-chain uptime attestation: tracker bug — fix gated
        </Text>
      </XStack>
      <Text fontSize="$2" color="$color11">
        The luxd on-chain uptime tracker currently reads 0.0000 for every validator — a known bug, not real
        downtime, and the fix is owner-gated. Liveness below is derived from the LIVE up / peers / height /
        bootstrapped signals instead, so a 0.0000 uptime is never shown or counted as down.
      </Text>
    </Card>
  )
}

/** One network's validator set: rollup badge + a per-validator table. */
function NetworkPanel({ net }: { net: NetworkSummary }) {
  const cols: Column<ValidatorRow>[] = [
    {
      key: 'instance',
      header: 'Validator',
      render: (r) => (
        <XStack items="center" gap="$2" minW={0}>
          <LivenessDot liveness={r.liveness} />
          <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
            {r.instance}
          </Text>
        </XStack>
      ),
    },
    { key: 'liveness', header: 'State', width: 132, render: (r) => <LivenessLabel liveness={r.liveness} /> },
    { key: 'height', header: 'C-Chain height', width: 130, align: 'right', mono: true, render: (r) => nOrDash(r.height) },
    { key: 'peers', header: 'Peers', width: 76, align: 'right', mono: true, render: (r) => nOrDash(r.peers) },
    {
      key: 'bootstrapped',
      header: 'Bootstrapped',
      width: 116,
      align: 'right',
      render: (r) => (
        <Text fontSize="$2" color={r.bootstrapped ? '$green11' : '$color10'} className="hz-mono">
          {r.bootstrapped ? 'yes' : 'no'}
        </Text>
      ),
    },
  ]
  return (
    <Panel
      title={net.label}
      grow={false}
      right={
        <XStack items="center" gap="$2">
          {net.primary ? (
            <XStack items="center" gap="$1">
              <Coins size={13} color="$color10" />
              <Text fontSize="$1" color="$color10">
                {PRIMARY_STAKED_LUX} LUX staked · {PRIMARY_BOND_LUX} each
              </Text>
            </XStack>
          ) : null}
          <Text fontSize="$2" fontWeight="700" color="$color12" className="hz-mono">
            {nOrDash(net.up)} / {nOrDash(net.total)} up
          </Text>
        </XStack>
      }
    >
      <DataTable
        columns={cols}
        rows={net.validators}
        rowKey={(r) => `${r.network}:${r.instance}`}
        empty="No validators reporting for this network yet."
      />
    </Panel>
  )
}

/**
 * Coming-soon slots for the sovereign L1/L2 networks in the Lux stack whose validator
 * exporters/RPCs are not yet wired. Makes the board visibly multi-network-ready; each
 * network lights up with live data automatically once its set publishes. Labels are
 * white-label-safe (Lux-ecosystem L1s named; L2 slots keyed by neutral chainId).
 */
function ComingSoonNetworks() {
  return (
    <Panel title="Sovereign networks · coming soon" grow={false}>
      <XStack gap="$2" flexWrap="wrap">
        {COMING_SOON_NETWORKS.map((n) => (
          <XStack key={n.id} items="center" gap="$2" borderWidth={1} borderColor="$borderColor" rounded="$4" px="$3" py="$2" bg="$color1">
            <Network size={14} color="$color9" />
            <Text fontSize="$2" color="$color11" fontWeight="600">
              {n.label}
            </Text>
            <Text fontSize="$1" color="$color9">
              {n.kind} · exporter pending
            </Text>
          </XStack>
        ))}
      </XStack>
      <Text fontSize="$1" color="$color9">
        Each sovereign network runs its own validator set; it appears with live validators automatically once its
        exporter publishes into the telemetry hub — no code change.
      </Text>
    </Panel>
  )
}

/** available/desired replicas per named Lux service (deduped to a canonical namespace). */
function ServiceGrid({ rows }: { rows: ServiceStatus[] }) {
  const cols: Column<ServiceStatus>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (r) => (
        <XStack items="center" gap="$2" minW={0}>
          {!r.deployed ? (
            <XCircle size={14} color="$color9" />
          ) : r.healthy ? (
            <CheckCircle2 size={14} color="$green10" />
          ) : (
            <TriangleAlert size={14} color="$yellow10" />
          )}
          <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
            {r.service}
          </Text>
        </XStack>
      ),
    },
    {
      key: 'replicas',
      header: 'Available / desired',
      width: 160,
      align: 'right',
      mono: true,
      render: (r) => (r.deployed ? `${r.running} / ${r.total}` : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      width: 140,
      render: (r) => (
        <Text fontSize="$2" fontWeight="600" color={!r.deployed ? '$color10' : r.healthy ? '$green11' : '$yellow11'}>
          {!r.deployed ? 'Not deployed' : r.healthy ? 'Healthy' : 'Degraded'}
        </Text>
      ),
    },
  ]
  return <DataTable columns={cols} rows={rows} rowKey={(r) => r.service} empty="No services reporting." />
}

/** A colored liveness dot (green live / amber bootstrapping / red down). */
function LivenessDot({ liveness }: { liveness: Liveness }) {
  const color = liveness === 'live' ? '$green10' : liveness === 'bootstrapping' ? '$yellow10' : '$red10'
  return <YStack width={9} height={9} rounded="$10" bg={color} />
}

function LivenessLabel({ liveness }: { liveness: Liveness }) {
  const [label, color] =
    liveness === 'live' ? ['Live', '$green11'] : liveness === 'bootstrapping' ? ['Bootstrapping', '$yellow11'] : ['Down', '$red11']
  return (
    <Text fontSize="$2" fontWeight="600" color={color as never}>
      {label}
    </Text>
  )
}

/** Honest failure card — 501 not-configured, 401 access, else a real error. */
function LuxError({ status, message, onRetry }: { status: number; message: string; onRetry: () => void }) {
  const title =
    status === 501
      ? 'Telemetry not configured'
      : status === 401 || status === 403
        ? 'Operator access required'
        : 'Could not reach the telemetry store'
  const body =
    status === 501
      ? 'This console reads Lux telemetry from the telemetry store, but its URL is not set on this deployment yet. Once it is, live validator and infrastructure metrics appear here — no fabricated data is shown.'
      : status === 401 || status === 403
        ? 'The Lux Network board is a platform-operator surface. Sign in with an operator account to view it.'
        : message
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
      <XStack gap="$2" items="center">
        <TriangleAlert size={16} />
        <Text fontSize="$4" fontWeight="700">
          {title}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {body}
      </Text>
      {status !== 401 && status !== 403 ? (
        <Button size="$2" self="flex-start" icon={<Gauge size={15} />} onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  )
}
