'use client'

/**
 * Fine-tuning — custom model training runs (base model, progress, status)
 * orchestrated by the platform.
 *
 * Reads the fine-tuning jobs from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/finetuning/jobs`), which injects the service token server-side. When
 * the fine-tuning service isn't provisioned for the org the list load fails and
 * the honest not-configured / unavailable card renders instead of an empty grid —
 * matching every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw, Sparkles } from '@hanzogui/lucide-icons-2'

import { restGet } from '~/lib/api/client'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusTag } from '~/components/ui/StatusTag'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const paas = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

type FinetuningJob = {
  id: string
  name?: string
  baseModel?: string
  status?: string
  progress?: number
  createdAt?: string
}

export function FinetuningModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<FinetuningJob[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ jobs?: FinetuningJob[] }>(paas('finetuning/jobs'))
      setRows(r.jobs ?? [])
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

  const columns: Column<FinetuningJob>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (j) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {j.name || j.id}
        </Text>
      ),
    },
    {
      key: 'baseModel',
      header: 'Base model',
      width: 180,
      render: (j) => (
        <Text fontSize="$3" color="$color11">
          {j.baseModel || '—'}
        </Text>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      width: 110,
      render: (j) => (
        <Text fontSize="$3" color="$color11">
          {j.progress ?? '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (j) => <StatusTag status={j.status ?? 'unknown'} />,
    },
    {
      key: 'createdAt',
      header: 'Created',
      width: 190,
      render: (j) => (
        <Text fontSize="$3" color="$color11">
          {j.createdAt ? new Date(j.createdAt).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Fine-tuning"
        subtitle="Custom model training runs."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loadError ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Fine-tune a model"
          description="Train a base model on your own data to specialize it for your domain — then serve the result as a private model behind your gateway."
          bullets={[
            'Upload a dataset (JSONL) to Object Storage or a Store',
            'Start a fine-tune from a Zen base model with the CLI or SDK',
            'Track progress here and deploy the result to Inference',
          ]}
          primary={{ label: 'Start a fine-tune', href: 'https://docs.hanzo.ai/fine-tuning' }}
          secondary={{ label: 'Prepare a dataset', onPress: () => { if (typeof window !== 'undefined') window.location.assign('/datasets') } }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(j) => j.id}
          empty="No fine-tuning jobs yet."
        />
      )}
    </>
  )
}
