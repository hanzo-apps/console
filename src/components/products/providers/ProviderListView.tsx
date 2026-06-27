'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack } from '@hanzo/gui'
import { Plus, Trash } from '@hanzogui/lucide-icons-2'

import { ApiError, ProviderApi, type Provider } from '~/lib/zap'
import { useSession } from '~/lib/auth/session'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { newProvider } from './logic'

const Badge = ({ on }: { on?: boolean }) => (
  <Text
    fontSize="$1"
    px="$2"
    py="$1"
    rounded="$2"
    bg={on ? '$color5' : '$color3'}
    color={on ? '$color12' : '$color11'}
  >
    {on ? 'ON' : 'OFF'}
  </Text>
)

export function ProviderListView({ onOpen }: { onOpen: (p: Provider) => void }) {
  const { account } = useSession()
  const owner = account?.name ?? 'admin'

  const [rows, setRows] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { rows } = await ProviderApi.list({ owner })
      setRows(rows ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load providers')
    } finally {
      setLoading(false)
    }
  }, [owner])

  useEffect(() => {
    void load()
  }, [load])

  const onAdd = async () => {
    try {
      const p = newProvider(owner)
      await ProviderApi.add(p)
      onOpen(p)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to add provider')
    }
  }

  const onDelete = async (p: Provider) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete provider "${p.name}"?`)) return
    try {
      await ProviderApi.remove(p)
      setRows((rs) => rs.filter((r) => r.name !== p.name))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete provider')
    }
  }

  const columns: Column<Provider>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (p) => (
        <Text fontSize="$3" color="$color12" onPress={() => onOpen(p)} cursor="pointer">
          {p.name}
        </Text>
      ),
    },
    { key: 'displayName', header: 'Display name' },
    { key: 'category', header: 'Category', width: 120 },
    { key: 'type', header: 'Type', width: 130 },
    { key: 'subType', header: 'Sub type', width: 150 },
    { key: 'isDefault', header: 'Default', width: 80, render: (p) => <Badge on={p.isDefault} /> },
    { key: 'state', header: 'State', width: 100 },
    {
      key: 'action',
      header: '',
      width: 150,
      render: (p) => (
        <XStack gap="$2">
          <Button size="$2" onPress={() => onOpen(p)}>
            {p.isRemote ? 'View' : 'Edit'}
          </Button>
          {!p.isRemote ? (
            <Button size="$2" icon={<Trash size={14} />} onPress={() => void onDelete(p)} />
          ) : null}
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Providers"
        subtitle="Model, storage, and embedding providers."
        actions={
          <Button icon={<Plus size={16} />} onPress={() => void onAdd()}>
            Add
          </Button>
        }
      />
      {error ? <Text color="$color12">{error}</Text> : null}
      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(p) => `${p.owner}/${p.name}`}
        empty="No providers yet. Click Add to create one."
      />
    </>
  )
}
