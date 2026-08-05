'use client'

/**
 * VPC — virtual private clouds providing network isolation (an org's private
 * address space, carved into subnets across regions).
 *
 * FULL CRUD over the unified cloud binary via the same-origin user-bearer `/v1`
 * proxy, org resolved from the Bearer owner:
 *   - GET    /v1/vpcs        list
 *   - POST   /v1/vpcs        create (name + CIDR + region)
 *   - DELETE /v1/vpcs/:id    delete
 *
 * When the backend doesn't serve the surface the list load fails and the honest
 * not-configured / unavailable card renders instead of an empty grid; create/delete
 * surface the real error message. Nothing is fabricated.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { Network, Plus, RefreshCw, Trash2 } from '@hanzogui/lucide-icons-2'

import { restGet, restPost, restDelete, cloudProxyV1Url } from '~/lib/api/client'
import { DOKS_REGIONS } from '~/lib/api'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'
import { DataTable, FieldRow, FieldSelect, FieldText, PageHeader, StatusTag, type Column } from '@hanzo/ui/product'

const enc = encodeURIComponent

type Vpc = {
  id: string
  name?: string
  cidr?: string
  region?: string
  subnets?: string[]
  status?: string
}

/** Pull a `Vpc[]` from `{vpcs:[…]}`, `{data:[…]}`, or a bare array (defensive). */
const vpcsOf = (payload: unknown): Vpc[] => {
  if (Array.isArray(payload)) return payload as Vpc[]
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    if (Array.isArray(o.vpcs)) return o.vpcs as Vpc[]
    if (Array.isArray(o.data)) return o.data as Vpc[]
  }
  return []
}

export function VpcModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Vpc[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  // Create form
  const [name, setName] = useState('')
  const [cidr, setCidr] = useState('10.10.0.0/16')
  const [region, setRegion] = useState<string>(DOKS_REGIONS[2]) // sfo3
  const [creating, setCreating] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<unknown>(cloudProxyV1Url('vpcs'))
      setRows(vpcsOf(r))
      setLoadError(null)
    } catch (e) {
      setLoadError(interpretPlatformError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    if (!name.trim()) {
      setActionMsg({ tone: 'err', text: 'Name is required.' })
      return
    }
    setCreating(true)
    setActionMsg(null)
    try {
      await restPost(cloudProxyV1Url('vpcs'), { name: name.trim(), cidr: cidr.trim() || undefined, region })
      setActionMsg({ tone: 'ok', text: `Created VPC "${name.trim()}".` })
      setName('')
      await load()
    } catch (e) {
      setActionMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setCreating(false)
    }
  }

  const onDelete = async (v: Vpc) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete VPC "${v.name || v.id}"? This cannot be undone.`)) return
    setActionMsg(null)
    try {
      await restDelete(cloudProxyV1Url(`vpcs/${enc(v.id)}`))
      setActionMsg({ tone: 'ok', text: `Deleted VPC "${v.name || v.id}".` })
      await load()
    } catch (e) {
      setActionMsg({ tone: 'err', text: `Could not delete "${v.name || v.id}": ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const columns: Column<Vpc>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (v) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {v.name || v.id}
        </Text>
      ),
    },
    {
      key: 'cidr',
      header: 'CIDR',
      width: 150,
      render: (v) => (
        <Text fontSize="$3" color="$color11" style={{ fontFamily: 'monospace' }}>
          {v.cidr || '—'}
        </Text>
      ),
    },
    {
      key: 'region',
      header: 'Region',
      width: 130,
      render: (v) => (
        <Text fontSize="$3" color="$color11">
          {v.region || '—'}
        </Text>
      ),
    },
    {
      key: 'subnets',
      header: 'Subnets',
      width: 100,
      render: (v) => (
        <Text fontSize="$3" color="$color11">
          {v.subnets?.length ?? 0}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (v) => <StatusTag status={v.status ?? 'unknown'} />,
    },
    {
      key: 'action',
      header: '',
      width: 60,
      render: (v) => (
        <XStack justify="flex-end" flex={1}>
          <Button size="$2" chromeless theme="red" icon={<Trash2 size={14} />} onPress={() => void onDelete(v)} aria-label={`Delete ${v.name || v.id}`} />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="VPC"
        subtitle="Virtual private clouds — network isolation."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loadError ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(v) => v.id}
            empty="No VPCs yet. Create one below."
          />

          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={460}>
            <XStack gap="$2" items="center">
              <Network size={16} />
              <Text fontSize="$5" fontWeight="700">
                New VPC
              </Text>
            </XStack>
            <FieldRow label="Name">
              <FieldText value={name} onChange={setName} placeholder="prod-net" />
            </FieldRow>
            <FieldRow label="CIDR">
              <FieldText value={cidr} onChange={setCidr} placeholder="10.10.0.0/16" />
            </FieldRow>
            <FieldRow label="Region">
              <FieldSelect value={region} options={[...DOKS_REGIONS]} onChange={setRegion} />
            </FieldRow>
            <XStack gap="$3" items="center">
              <Button self="flex-start" theme="light" icon={<Plus size={16} />} disabled={creating} onPress={() => void onCreate()}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
              {actionMsg ? (
                <Text fontSize="$2" color={actionMsg.tone === 'ok' ? '$color11' : '$red10'}>
                  {actionMsg.text}
                </Text>
              ) : null}
            </XStack>
            <Text fontSize="$2" color="$color10">
              A VPC gives your org a private address space, carved into subnets across regions.
            </Text>
          </Card>
        </>
      )}
    </>
  )
}
