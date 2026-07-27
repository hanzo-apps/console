'use client'

/**
 * Networks — the embedded Bootnode ("Web3 Backend in a Box") blockchain-network
 * admin. The core web3 primitive the lux/zoo consoles surface under Web3:
 * blockchain networks (chain, node count, status, RPC). Reads the REAL bootnode
 * control plane through console2's own `/bootnode/*` per-user proxy — no fakes,
 * honest states on 401/404/503/error.
 *
 * Same shape as the Base embed: the browser hits console2's origin with just the
 * session cookie; the server proxy mints + forwards the user's IAM bearer to the
 * bootnode API. Rendered with @hanzo/data's DataTable, so the network rows use
 * the same field engine as every other object surface.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { DataTable, type FieldDefinition } from '@hanzo/data'

import { PageHeader } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { ApiError } from '~/lib/api/client'

/** One blockchain network as the bootnode `/v1/networks` API returns it. */
interface BootnodeNetwork {
  id: string
  name?: string
  chain?: string
  status?: string
  nodes?: number
  rpc?: string
  [k: string]: unknown
}

/** Columns for the networks grid — chain/nodes/status/RPC, via @hanzo/data. */
const FIELDS: FieldDefinition[] = [
  { name: 'name', label: 'Network', type: 'text', width: 180 },
  { name: 'chain', label: 'Chain', type: 'text', width: 120 },
  { name: 'status', label: 'Status', type: 'text', width: 120 },
  { name: 'nodes', label: 'Nodes', type: 'number', width: 90 },
  { name: 'rpc', label: 'RPC', type: 'url' },
]

async function listNetworks(): Promise<BootnodeNetwork[]> {
  const res = await fetch('/v1/networks', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = `Networks ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) msg = String(body.error)
    } catch { /* not JSON */ }
    throw new ApiError(msg, res.status)
  }
  const json = await res.json().catch(() => null)
  // Tolerant of `{items:[…]}` or a bare array.
  const items = Array.isArray(json) ? json : (json?.items ?? json?.networks ?? [])
  return Array.isArray(items) ? items : []
}

export function NetworksModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<BootnodeNetwork[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setState(null)
    try {
      setRows(await listNetworks())
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <YStack gap="$4">
      <PageHeader
        title="Networks"
        subtitle="Blockchain networks — chain, nodes, status, and RPC (Bootnode)."
        actions={<Button size="$3" onPress={load} disabled={loading}>Refresh</Button>}
      />
      {state ? (
        <BackendStateCard state={state} onRetry={load} hint="endpoint · GET /v1/networks" />
      ) : (
        <DataTable
          fields={FIELDS}
          records={rows as Array<Record<string, unknown>>}
          loading={loading}
          empty="No networks yet. Launch one with the Bootnode API or CLI."
        />
      )}
      {!state && (
        <XStack>
          <Text fontSize="$2" color="$color10">
            Provision networks via the Bootnode API (`POST /v1/networks`) or CLI — this view manages what exists.
          </Text>
        </XStack>
      )}
    </YStack>
  )
}

