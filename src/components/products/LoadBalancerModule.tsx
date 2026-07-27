'use client'

/**
 * Load Balancers — L4/L7 traffic distribution across backend targets (the
 * platform's managed LBs, with their virtual IPs and health-checked pools).
 *
 * FULL CRUD over the unified cloud binary via the same-origin user-bearer `/v1`
 * proxy, org resolved from the Bearer owner:
 *   - GET    /v1/load-balancers        list
 *   - POST   /v1/load-balancers        create (name + type + region)
 *   - DELETE /v1/load-balancers/:id    delete
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
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { FieldRow, FieldText, FieldSelect } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const enc = encodeURIComponent

/** L4/L7 protocols a managed load balancer can front. */
const LB_TYPES = ['http', 'https', 'tcp'] as const

type LoadBalancer = {
  id: string
  name?: string
  type?: string
  targets?: number
  ip?: string
  status?: string
}

/** Pull a `LoadBalancer[]` from `{loadBalancers:[…]}`, `{data:[…]}`, or a bare array. */
const lbsOf = (payload: unknown): LoadBalancer[] => {
  if (Array.isArray(payload)) return payload as LoadBalancer[]
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    if (Array.isArray(o.loadBalancers)) return o.loadBalancers as LoadBalancer[]
    if (Array.isArray(o.data)) return o.data as LoadBalancer[]
  }
  return []
}

export function LoadBalancerModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<LoadBalancer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  // Create form
  const [name, setName] = useState('')
  const [type, setType] = useState<string>(LB_TYPES[0])
  const [region, setRegion] = useState<string>(DOKS_REGIONS[2]) // sfo3
  const [creating, setCreating] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<unknown>(cloudProxyV1Url('load-balancers'))
      setRows(lbsOf(r))
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
      await restPost(cloudProxyV1Url('load-balancers'), { name: name.trim(), type, region })
      setActionMsg({ tone: 'ok', text: `Created load balancer "${name.trim()}".` })
      setName('')
      await load()
    } catch (e) {
      setActionMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setCreating(false)
    }
  }

  const onDelete = async (lb: LoadBalancer) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete load balancer "${lb.name || lb.id}"? This cannot be undone.`)) return
    setActionMsg(null)
    try {
      await restDelete(cloudProxyV1Url(`load-balancers/${enc(lb.id)}`))
      setActionMsg({ tone: 'ok', text: `Deleted load balancer "${lb.name || lb.id}".` })
      await load()
    } catch (e) {
      setActionMsg({ tone: 'err', text: `Could not delete "${lb.name || lb.id}": ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const columns: Column<LoadBalancer>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (lb) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {lb.name || lb.id}
        </Text>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 110,
      render: (lb) => (
        <Text fontSize="$3" color="$color11">
          {lb.type || '—'}
        </Text>
      ),
    },
    {
      key: 'ip',
      header: 'IP',
      width: 150,
      render: (lb) => (
        <Text fontSize="$3" color="$color11" style={{ fontFamily: 'monospace' }}>
          {lb.ip || '—'}
        </Text>
      ),
    },
    {
      key: 'targets',
      header: 'Targets',
      width: 100,
      render: (lb) => (
        <Text fontSize="$3" color="$color11">
          {lb.targets ?? 0}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (lb) => <StatusTag status={lb.status ?? 'unknown'} />,
    },
    {
      key: 'action',
      header: '',
      width: 60,
      render: (lb) => (
        <XStack justify="flex-end" flex={1}>
          <Button size="$2" chromeless theme="red" icon={<Trash2 size={14} />} onPress={() => void onDelete(lb)} aria-label={`Delete ${lb.name || lb.id}`} />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Load Balancers"
        subtitle="L4/L7 traffic distribution."
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
            rowKey={(lb) => lb.id}
            empty="No load balancers yet. Create one below."
          />

          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={460}>
            <XStack gap="$2" items="center">
              <Network size={16} />
              <Text fontSize="$5" fontWeight="700">
                New load balancer
              </Text>
            </XStack>
            <FieldRow label="Name">
              <FieldText value={name} onChange={setName} placeholder="prod-lb" />
            </FieldRow>
            <FieldRow label="Type">
              <FieldSelect value={type} options={[...LB_TYPES]} onChange={setType} />
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
              A managed load balancer distributes traffic across your backend targets with health checks.
            </Text>
          </Card>
        </>
      )}
    </>
  )
}
