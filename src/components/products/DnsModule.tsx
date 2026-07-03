'use client'

/**
 * DNS — per-org managed DNS (zones + records), backed by the hanzodns control
 * plane (CoreDNS + Cloudflare sync). The browser hits console2's origin with just
 * the session cookie on the unified `/v1/dns` surface (api.hanzo.ai gateway →
 * hanzodns); records are org-scoped by the `X-Org-Id` the cloud client stamps.
 * Honest states on 401/404/503 — never fabricates a zone or record.
 *
 * hanzodns owns the write path (a change to a zone re-syncs to CoreDNS in-cluster
 * AND to Cloudflare), so this view manages what exists and reflects sync status;
 * it does not invent authoritative records.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { DataTable, type FieldDefinition } from '@hanzo/data'

import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { ApiError } from '~/lib/api/client'

/** A DNS zone as hanzodns `/v1/dns/zones` returns it. */
interface Zone {
  id: string
  name?: string
  provider?: string
  records?: number
  status?: string
  updatedTime?: string
  [k: string]: unknown
}

/** A record within a zone (`/v1/dns/zones/{name}/records`). */
interface DnsRecord {
  id: string
  name?: string
  type?: string
  value?: string
  ttl?: number
  [k: string]: unknown
}

const ZONE_FIELDS: FieldDefinition[] = [
  { name: 'name', label: 'Zone', type: 'text', width: 220 },
  { name: 'provider', label: 'Provider', type: 'text', width: 130 },
  { name: 'records', label: 'Records', type: 'number', width: 100 },
  { name: 'status', label: 'Sync', type: 'text', width: 120 },
  { name: 'updatedTime', label: 'Updated', type: 'dateTime' },
]

const RECORD_FIELDS: FieldDefinition[] = [
  { name: 'name', label: 'Name', type: 'text', width: 220 },
  { name: 'type', label: 'Type', type: 'text', width: 90 },
  { name: 'ttl', label: 'TTL', type: 'number', width: 90 },
  { name: 'value', label: 'Value', type: 'text' },
]

async function getJSON<T>(path: string): Promise<T[]> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = `DNS ${res.status}`
    try {
      const body = await res.json()
      if (body?.error || body?.msg) msg = String(body.error ?? body.msg)
    } catch { /* not JSON */ }
    throw new ApiError(msg, res.status)
  }
  const json = await res.json().catch(() => null)
  const items = Array.isArray(json) ? json : (json?.items ?? json?.zones ?? json?.records ?? json?.data ?? [])
  return Array.isArray(items) ? items : []
}

export function DnsModule(_props: { params: Record<string, string> }) {
  const [zones, setZones] = useState<Zone[]>([])
  const [zone, setZone] = useState<Zone | null>(null)
  const [records, setRecords] = useState<DnsRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)

  const loadZones = useCallback(async () => {
    setLoading(true)
    setState(null)
    setZone(null)
    try {
      setZones(await getJSON<Zone>('/v1/dns/zones'))
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const openZone = useCallback(async (z: Zone) => {
    setZone(z)
    setLoading(true)
    setState(null)
    try {
      setRecords(await getJSON<DnsRecord>(`/v1/dns/zones/${encodeURIComponent(z.name ?? z.id)}/records`))
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadZones() }, [loadZones])

  const inZone = zone !== null

  return (
    <YStack gap="$4">
      <PageHeader
        title={inZone ? `DNS · ${zone?.name ?? zone?.id}` : 'DNS'}
        subtitle={
          inZone
            ? 'Records in this zone — synced to CoreDNS (in-cluster) and Cloudflare by hanzodns.'
            : 'Per-org managed DNS zones — provider, record count, and sync status (hanzodns).'
        }
        actions={
          <XStack gap="$2">
            {inZone && (
              <Button size="$3" onPress={loadZones} disabled={loading}>All zones</Button>
            )}
            <Button size="$3" onPress={inZone ? () => openZone(zone!) : loadZones} disabled={loading}>
              Refresh
            </Button>
          </XStack>
        }
      />
      {state ? (
        <BackendStateCard
          state={state}
          onRetry={inZone ? () => openZone(zone!) : loadZones}
          hint={inZone ? 'endpoint · GET /v1/dns/zones/{zone}/records' : 'endpoint · GET /v1/dns/zones'}
        />
      ) : inZone ? (
        <DataTable
          fields={RECORD_FIELDS}
          records={records as Array<Record<string, unknown>>}
          loading={loading}
          empty="No records in this zone yet."
        />
      ) : (
        <DataTable
          fields={ZONE_FIELDS}
          records={zones as Array<Record<string, unknown>>}
          loading={loading}
          onOpen={(row) => openZone(row as Zone)}
          empty="No DNS zones yet. Create one with the hanzodns API or CLI."
        />
      )}
      {!state && !inZone && (
        <XStack>
          <Text fontSize="$2" color="$color10">
            Zones and records are the source of truth in hanzodns; edits re-sync to CoreDNS + Cloudflare. Provision via the hanzodns API (`POST /v1/dns/zones`) or CLI.
          </Text>
        </XStack>
      )}
    </YStack>
  )
}

export default DnsModule
