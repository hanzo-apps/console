'use client'

/**
 * Nodes — per-node blockchain infrastructure (validators + peers) across the REAL
 * luxd primary networks. The all-networks super-admin/infra view on the hanzo
 * brand; scoped to a brand's own chain on lux/zoo/pars. Reads the live luxd RPC
 * (P-chain `platform.getCurrentValidators` + node `info.peers`) through console2's
 * own `/nodes` per-user proxy — no fakes, honest "not reporting" per unreachable
 * network, honest empty when a reachable network has zero nodes.
 *
 * Same shape as NetworksModule (the Bootnode embed): the browser hits console2's
 * origin with just the session cookie; the server proxy resolves the brand from
 * the host and calls the allowlisted luxd methods per brand-scoped network.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { DataTable, type FieldDefinition } from '@hanzo/data'

import { PageHeader } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import {
  NodesApi,
  fmtHeight,
  fmtUptime,
  type NetworkInventory,
  type NodeNetworkId,
} from '~/lib/api/nodes'
import { findEntry } from '~/lib/products/registry'

/** Columns for the node grid — the uniform per-node row. Rendered via @hanzo/data. */
const FIELDS: FieldDefinition[] = [
  { name: 'network', label: 'Network', type: 'text', width: 130 },
  { name: 'role', label: 'Role', type: 'text', width: 100 },
  { name: 'nodeID', label: 'Node ID', type: 'text', width: 300 },
  { name: 'version', label: 'Version', type: 'text', width: 120 },
  { name: 'status', label: 'Status', type: 'text', width: 110 },
  { name: 'uptime', label: 'Uptime', type: 'text', width: 90 },
  { name: 'height', label: 'Height', type: 'text', width: 120 },
]

/** Columns for the chains grid — the network's primary-network chains. */
const CHAIN_FIELDS: FieldDefinition[] = [
  { name: 'network', label: 'Network', type: 'text', width: 130 },
  { name: 'name', label: 'Chain', type: 'text', width: 120 },
  { name: 'id', label: 'Blockchain ID', type: 'text', width: 380 },
  { name: 'vmID', label: 'VM', type: 'text', width: 300 },
]

/** A reporting network's block height, shared by every node on it (real, honest). */
type DisplayRow = Record<string, unknown>

/** Flatten reporting networks → display rows (Height = the network's P-chain height). */
function toRows(inv: NetworkInventory[], filter: 'all' | NodeNetworkId): DisplayRow[] {
  return inv
    .filter((n) => n.status === 'reporting' && (filter === 'all' || n.id === filter))
    .flatMap((n) =>
      n.nodes.map((row) => ({
        network: n.label,
        role: row.role,
        nodeID: row.nodeID,
        version: row.version ?? '—',
        status: row.status,
        uptime: fmtUptime(row.uptimePct),
        height: fmtHeight(row.height ?? n.height),
      })),
    )
}

/** Flatten reporting networks → one row per chain (real `platform.getBlockchains`). */
function toChainRows(inv: NetworkInventory[], filter: 'all' | NodeNetworkId): DisplayRow[] {
  return inv
    .filter((n) => n.status === 'reporting' && (filter === 'all' || n.id === filter))
    .flatMap((n) =>
      n.chains.map((c) => ({
        network: n.label,
        name: c.name,
        id: c.id,
        vmID: c.vmID ?? '—',
      })),
    )
}

/** A short chain label (e.g. "T-Chain" → "T"), for the compact chain chips. */
function chainShort(name: string): string {
  const m = /^([A-Za-z])-Chain$/.exec(name)
  return m ? m[1] : name
}

/** Compact, real chain chips for a network — the primary-network chains luxd reports. */
function ChainChips({ chains }: { chains: NetworkInventory['chains'] }) {
  if (!chains.length) return null
  return (
    <YStack gap="$1.5">
      <Text fontSize="$1" color="$color10">Chains ({chains.length})</Text>
      <XStack gap="$1.5" flexWrap="wrap">
        {chains.map((c) => (
          <XStack
            key={c.id}
            bg="$color4"
            borderWidth={1}
            borderColor="$borderColor"
            rounded="$3"
            px="$2"
            py="$0.5"
            items="center"
          >
            <Text fontSize="$2" fontWeight="700">{chainShort(c.name)}</Text>
          </XStack>
        ))}
      </XStack>
    </YStack>
  )
}

/** Summary card for one network — label, health, counts, height, chains (all real). */
function NetworkCard({ n }: { n: NetworkInventory }) {
  const reporting = n.status === 'reporting'
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$2" minW={240} flex={1}>
      <XStack justify="space-between" items="center" gap="$2">
        <Text fontSize="$4" fontWeight="700">
          {n.label}
        </Text>
        <StatusTag status={reporting ? 'active' : 'down'} />
      </XStack>
      {reporting ? (
        <YStack gap="$3">
          <XStack gap="$4" flexWrap="wrap">
            <YStack>
              <Text fontSize="$1" color="$color10">Chains</Text>
              <Text fontSize="$5" fontWeight="800">{n.chains.length ? n.chains.length.toLocaleString() : '—'}</Text>
            </YStack>
            <YStack>
              <Text fontSize="$1" color="$color10">Validators</Text>
              <Text fontSize="$5" fontWeight="800">{n.validators.toLocaleString()}</Text>
            </YStack>
            <YStack>
              <Text fontSize="$1" color="$color10">Peers</Text>
              <Text fontSize="$5" fontWeight="800">{n.peers.toLocaleString()}</Text>
            </YStack>
            <YStack>
              <Text fontSize="$1" color="$color10">Height</Text>
              <Text fontSize="$5" fontWeight="800">{fmtHeight(n.height)}</Text>
            </YStack>
          </XStack>
          <ChainChips chains={n.chains} />
        </YStack>
      ) : (
        <Text fontSize="$2" color="$color10">
          Not reporting{n.error ? ` — ${n.error}` : ''}
        </Text>
      )}
      {reporting && n.version ? (
        <Text fontSize="$1" color="$color10">{n.version}</Text>
      ) : null}
    </Card>
  )
}

export function NodesModule(_props: { params: Record<string, string> }) {
  const [inv, setInv] = useState<NetworkInventory[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)
  const [filter, setFilter] = useState<'all' | NodeNetworkId>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setState(null)
    try {
      setInv(await NodesApi.inventory())
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const reporting = useMemo(() => inv.filter((n) => n.status === 'reporting'), [inv])
  const rows = useMemo(() => toRows(inv, filter), [inv, filter])
  const chainRows = useMemo(() => toChainRows(inv, filter), [inv, filter])
  const noneReachable = !loading && !state && inv.length > 0 && reporting.length === 0
  const nodesIcon = findEntry('nodes')?.icon

  return (
    <YStack gap="$4">
      <PageHeader
        title="Networks & Nodes"
        subtitle="Lux blockchain networks — their primary-network chains, validators, and peers. Chains are the live set the P-chain reports; height is the network P-chain height; uptime is as reported by the queried node."
        actions={<Button size="$3" onPress={load} disabled={loading}>Refresh</Button>}
      />

      {state ? (
        <BackendStateCard state={state} onRetry={load} hint="endpoint · GET /v1/nodes/inventory" />
      ) : (
        <>
          {inv.length > 0 && (
            <XStack gap="$3" flexWrap="wrap">
              {inv.map((n) => <NetworkCard key={n.id} n={n} />)}
            </XStack>
          )}

          {reporting.length > 1 && (
            <XStack gap="$2" flexWrap="wrap" items="center">
              <Button
                size="$2"
                bg={filter === 'all' ? '$color5' : 'transparent'}
                borderWidth={1}
                borderColor="$borderColor"
                onPress={() => setFilter('all')}
              >
                All
              </Button>
              {reporting.map((n) => (
                <Button
                  key={n.id}
                  size="$2"
                  bg={filter === n.id ? '$color5' : 'transparent'}
                  borderWidth={1}
                  borderColor="$borderColor"
                  onPress={() => setFilter(n.id)}
                >
                  {n.label}
                </Button>
              ))}
            </XStack>
          )}

          {noneReachable && nodesIcon ? (
            <EmptyState
              icon={nodesIcon}
              title="No networks reporting"
              description="None of the networks configured for this brand answered their luxd RPC. This view lights up automatically once a network is reachable — no placeholder nodes are shown."
            />
          ) : (
            <>
              {chainRows.length > 0 && (
                <YStack gap="$2">
                  <Text fontSize="$5" fontWeight="700">Chains</Text>
                  <Text fontSize="$2" color="$color10">
                    The primary-network chains each reporting network runs (live from the P-chain).
                  </Text>
                  <DataTable
                    fields={CHAIN_FIELDS}
                    records={chainRows}
                    loading={loading}
                    empty="No chains reported for the selected network(s)."
                  />
                </YStack>
              )}
              <YStack gap="$2">
                <Text fontSize="$5" fontWeight="700">Validators & peers</Text>
                <DataTable
                  fields={FIELDS}
                  records={rows}
                  loading={loading}
                  empty="No nodes reported for the selected network(s)."
                />
              </YStack>
            </>
          )}
        </>
      )}
    </YStack>
  )
}

