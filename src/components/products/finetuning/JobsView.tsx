'use client'

/**
 * Jobs list — every fine-tune run for the org, with live status. Honest states: a
 * real load failure renders the shared ErrorState (never fabricated rows), and a
 * genuine empty result renders a first-run intro with a single "New training job"
 * call-to-action.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Plus, Sparkles } from '@hanzogui/lucide-icons-2'

import { FinetuneApi, type FinetuneJob } from '~/lib/api/finetune'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { ErrorState, asApiError } from '~/components/ui/States'
import { ApiError } from '~/lib/api'
import { formatCents, jobTitle, methodLabel, progressOf } from './logic'

export function JobsView({ onOpen, onNew }: { onOpen: (name: string) => void; onNew: () => void }) {
  const [rows, setRows] = useState<FinetuneJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await FinetuneApi.listJobs())
      setError(null)
    } catch (e) {
      setError(asApiError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<FinetuneJob>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (j) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {jobTitle(j)}
        </Text>
      ),
    },
    {
      key: 'baseModel',
      header: 'Base model',
      width: 220,
      render: (j) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {j.baseModel || '—'}
        </Text>
      ),
    },
    {
      key: 'method',
      header: 'Type',
      width: 130,
      render: (j) => (
        <Text fontSize="$3" color="$color11">
          {methodLabel(j.method)}
        </Text>
      ),
    },
    { key: 'status', header: 'Status', width: 110, render: (j) => <StatusTag status={j.status} /> },
    {
      key: 'progress',
      header: 'Progress',
      width: 90,
      render: (j) => (
        <Text fontSize="$3" color="$color11">
          {progressOf(j)}%
        </Text>
      ),
    },
    {
      key: 'cost',
      header: 'Cost',
      width: 90,
      render: (j) => (
        <Text fontSize="$3" color="$color11">
          {j.costCents ? formatCents(j.costCents) : '—'}
        </Text>
      ),
    },
    {
      key: 'createdTime',
      header: 'Created',
      width: 180,
      render: (j) => (
        <Text fontSize="$3" color="$color11">
          {j.createdTime ? new Date(j.createdTime).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <YStack gap="$3">
      <XStack justify="flex-end" gap="$2">
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => void load()}>
          Refresh
        </Button>
        <PrimaryButton icon={<Plus size={15} />} onPress={onNew}>
          New training job
        </PrimaryButton>
      </XStack>

      {error ? (
        <ErrorState
          err={error}
          onRetry={() => void load()}
          copy={{
            notFound:
              'The fine-tuning broker is not routed on this deployment yet. It appears automatically once the cloud backend serves /v1/finetune.',
          }}
        />
      ) : !loading && rows.length === 0 ? (
        <Card borderWidth={1} borderColor="$borderColor" borderStyle="dashed" p="$6" gap="$3" items="center" maxW={560} self="center">
          <YStack width={48} height={48} items="center" justify="center" rounded="$4" bg="$color3">
            <Sparkles size={24} />
          </YStack>
          <Text fontSize="$6" fontWeight="800" text="center">
            Fine-tune a model
          </Text>
          <Text fontSize="$3" color="$color11" text="center" maxW={420}>
            Pick a HuggingFace base model and a dataset, choose LoRA / QLoRA / full, and train on our GPUs. Deploy the
            result to inference in one click.
          </Text>
          <PrimaryButton icon={<Plus size={15} />} onPress={onNew}>
            New training job
          </PrimaryButton>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(j) => j.name}
          onRowPress={(j) => onOpen(j.name)}
          empty="No fine-tuning jobs yet."
        />
      )}
    </YStack>
  )
}
