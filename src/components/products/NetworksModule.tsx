'use client'

/**
 * Networks — the org's overlay network on the Hanzo Zero Trust fabric: the routers
 * tagged for the org ARE its nodes, so an overlay exists once one has dialed home.
 * Reads the REAL per-org state off `GET /v1/network` (HIP-0139) — no fakes, honest
 * states on 401/404/503/error.
 *
 * The browser hits console2's origin with just the session cookie; the server proxy
 * mints + forwards the user's IAM bearer, and cloud scopes the read to the Bearer
 * owner's org. Rendered with @hanzo/data's DataTable, so the network rows use the
 * same field engine as every other object surface.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { DataTable, type FieldDefinition } from '@hanzo/data'

import { ApiError } from '~/lib/api/client'
import { BackendStateCard, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

/** One overlay network as `GET /v1/network` returns it. */
interface Network {
  id: string
  name?: string
  status?: string
  nodes?: number
  [k: string]: unknown
}

/** Columns for the networks grid — name/status/nodes, via @hanzo/data. */
const FIELDS: FieldDefinition[] = [
  { name: 'name', label: 'Network', type: 'text', width: 180 },
  { name: 'status', label: 'Status', type: 'text', width: 120 },
  { name: 'nodes', label: 'Nodes', type: 'number', width: 90 },
]

async function listNetworks(): Promise<Network[]> {
  const res = await fetch('/v1/network', {
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
  const items = json?.networks
  return Array.isArray(items) ? items : []
}

export function NetworksModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Network[]>([])
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
        subtitle="Your org's Zero Trust overlay — nodes and status."
        actions={<Button size="$3" onPress={load} disabled={loading}>Refresh</Button>}
      />
      {state ? (
        <BackendStateCard state={state} onRetry={load} hint="endpoint · GET /v1/network" />
      ) : (
        <DataTable
          fields={FIELDS}
          records={rows as Array<Record<string, unknown>>}
          loading={loading}
          empty="No overlay yet. One appears here once a router joins the fabric for your org."
        />
      )}
      {!state && (
        <XStack>
          <Text fontSize="$2" color="$color10">
            The overlay is projected from your org's routers — its nodes are the routers on the fabric, and it reads
            connected once one has dialed home.
          </Text>
        </XStack>
      )}
    </YStack>
  )
}

