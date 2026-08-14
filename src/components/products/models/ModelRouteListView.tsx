'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack } from '@hanzo/gui'
import { Plus, Trash } from '@hanzogui/lucide-icons-2'

import { ApiError, ModelRouteApi, type ModelRoute } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

const Tag = ({ on, on_label, off_label }: { on?: boolean; on_label: string; off_label: string }) => (
  <Text
    fontSize="$1"
    px="$2"
    py="$1"
    rounded="$2"
    bg={on ? '$color5' : '$color3'}
    color={on ? '$color12' : '$color11'}
  >
    {on ? on_label : off_label}
  </Text>
)

const price = (n?: number) => (n && n > 0 ? `$${n.toFixed(2)}` : '-')

export function ModelRouteListView({
  onOpen,
  onNew,
}: {
  onOpen: (r: ModelRoute) => void
  onNew: () => void
}) {
  // Tenant scope: model routes are org-owned. Use the active org scope.
  const owner = currentOrg()

  const [rows, setRows] = useState<ModelRoute[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { rows } = await ModelRouteApi.list({ owner })
      setRows(rows ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load model routes')
    } finally {
      setLoading(false)
    }
  }, [owner])

  useEffect(() => {
    void load()
  }, [load])

  const onDelete = async (r: ModelRoute) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete route "${r.modelName}"?`)) return
    try {
      await ModelRouteApi.remove(r)
      setRows((rs) => rs.filter((x) => x.modelName !== r.modelName))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete model route')
    }
  }

  const columns: Column<ModelRoute>[] = [
    {
      key: 'modelName',
      header: 'Model name',
      render: (r) => (
        <Text fontSize="$3" color="$color12" onPress={() => onOpen(r)} cursor="pointer">
          {r.modelName}
        </Text>
      ),
    },
    { key: 'provider', header: 'Provider', width: 150 },
    { key: 'upstream', header: 'Upstream', width: 220 },
    {
      key: 'premium',
      header: 'Premium',
      width: 100,
      render: (r) => <Tag on={r.premium} on_label="Premium" off_label="Free" />,
    },
    { key: 'inputPricePerMillion', header: 'In $/M', width: 90, render: (r) => <Text fontSize="$3">{price(r.inputPricePerMillion)}</Text> },
    { key: 'outputPricePerMillion', header: 'Out $/M', width: 90, render: (r) => <Text fontSize="$3">{price(r.outputPricePerMillion)}</Text> },
    {
      key: 'enabled',
      header: 'Enabled',
      width: 90,
      render: (r) => <Tag on={r.enabled} on_label="ON" off_label="OFF" />,
    },
    {
      key: 'action',
      header: '',
      width: 150,
      render: (r) => (
        <XStack gap="$2">
          <Button size="$2" onPress={() => onOpen(r)}>
            Edit
          </Button>
          <Button size="$2" icon={<Trash size={14} />} onPress={() => void onDelete(r)} />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Models"
        subtitle="Model routes and routing policy."
        actions={
          <Button icon={<Plus size={16} />} onPress={onNew}>
            Add route
          </Button>
        }
      />
      {error ? <Text color="$color12">{error}</Text> : null}
      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => `${r.owner}/${r.modelName}`}
        empty="No model routes yet. Click Add to create one."
      />
    </>
  )
}
