'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack } from '@hanzo/gui'
import { Plus, RefreshCw, Trash } from '@hanzogui/lucide-icons-2'

import { ApiError, StoreApi, type Store } from '~/lib/api'
import { useSession } from '~/lib/auth/session'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { newStore } from './logic'

const Badge = ({ on }: { on?: boolean }) => (
  <Text
    fontSize="$1"
    px="$2"
    py="$1"
    rounded="$2"
    bg={on ? '$green5' : '$color3'}
    color={on ? '$green11' : '$color11'}
  >
    {on ? 'ON' : 'OFF'}
  </Text>
)

export function StoreListView({ onOpen }: { onOpen: (s: Store) => void }) {
  const { account } = useSession()
  const owner = account?.name ?? 'admin'

  const [rows, setRows] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await StoreApi.list(owner)
      setRows(data ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load stores')
    } finally {
      setLoading(false)
    }
  }, [owner])

  useEffect(() => {
    void load()
  }, [load])

  const onAdd = async () => {
    try {
      const s = newStore(owner)
      await StoreApi.add(s)
      onOpen(s)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to add store')
    }
  }

  const onRefresh = async (s: Store) => {
    try {
      await StoreApi.refreshVectors(s)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to refresh vectors')
    }
  }

  const onDelete = async (s: Store) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete store "${s.name}"?`)) return
    try {
      await StoreApi.remove(s)
      setRows((rs) => rs.filter((r) => r.name !== s.name))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete store')
    }
  }

  const columns: Column<Store>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (s) => (
        <Text fontSize="$3" color="$blue11" onPress={() => onOpen(s)} cursor="pointer">
          {s.name}
        </Text>
      ),
    },
    { key: 'displayName', header: 'Display name' },
    { key: 'modelProvider', header: 'Model provider', width: 170 },
    { key: 'embeddingProvider', header: 'Embedding provider', width: 180 },
    { key: 'isDefault', header: 'Default', width: 80, render: (s) => <Badge on={s.isDefault} /> },
    { key: 'state', header: 'State', width: 100 },
    {
      key: 'action',
      header: '',
      width: 200,
      render: (s) => (
        <XStack gap="$2">
          <Button size="$2" onPress={() => onOpen(s)}>
            Edit
          </Button>
          <Button size="$2" icon={<RefreshCw size={14} />} onPress={() => void onRefresh(s)} />
          <Button size="$2" theme="red" icon={<Trash size={14} />} onPress={() => void onDelete(s)} />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Stores"
        subtitle="Knowledge stores and vectors."
        actions={
          <Button icon={<Plus size={16} />} onPress={() => void onAdd()}>
            Add
          </Button>
        }
      />
      {error ? <Text color="$red10">{error}</Text> : null}
      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(s) => `${s.owner}/${s.name}`}
        empty="No stores yet. Click Add to create one."
      />
    </>
  )
}
