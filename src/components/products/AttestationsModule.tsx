'use client'

/**
 * Attestations — verifiable proofs (TEE/TDX remote attestation, signed build
 * provenance, on-chain attestations) issued and verified by the platform.
 *
 * Reads the attestation ledger from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/attestations`), which injects the service token server-side. When the
 * attestation service isn't provisioned for the org the list load fails and the
 * honest not-configured / unavailable card renders instead of an empty grid —
 * matching every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet } from '~/lib/api/client'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const paas = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

type Attestation = {
  id: string
  type?: string
  subject?: string
  status?: string
  issuer?: string
  createdAt?: string
}

export function AttestationsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Attestation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ attestations?: Attestation[] }>(paas('attestations'))
      setRows(r.attestations ?? [])
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

  const columns: Column<Attestation>[] = [
    {
      key: 'subject',
      header: 'Subject',
      render: (a) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {a.subject || a.id}
        </Text>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 160,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.type || '—'}
        </Text>
      ),
    },
    {
      key: 'issuer',
      header: 'Issuer',
      width: 200,
      render: (a) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {a.issuer || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (a) => <StatusTag status={a.status ?? 'unknown'} />,
    },
    {
      key: 'createdAt',
      header: 'Issued',
      width: 190,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Attestations"
        subtitle="Verifiable proofs — TEE remote attestation, build provenance, on-chain attestations."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loadError ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(a) => a.id}
          empty="No attestations yet. Proofs issued by the platform appear here."
        />
      )}
    </>
  )
}
