'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack } from '@hanzo/gui'
import { Plus, Trash } from '@hanzogui/lucide-icons-2'

import { ApiError, ApplicationApi, type Application } from '~/lib/api'
import { useSession } from '~/lib/auth/session'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { newApplication } from './logic'

const StatusTag = ({ status }: { status?: string }) => {
  const running = status && status !== 'Not Deployed' && status !== 'Failed'
  return (
    <Text
      fontSize="$1"
      px="$2"
      py="$1"
      rounded="$2"
      bg={running ? '$green5' : status === 'Failed' ? '$red5' : '$color3'}
      color={running ? '$green11' : status === 'Failed' ? '$red11' : '$color11'}
    >
      {status ?? 'Not Deployed'}
    </Text>
  )
}

export function ApplicationListView({ onOpen }: { onOpen: (a: Application) => void }) {
  const { account } = useSession()
  const owner = account?.name ?? 'admin'

  const [rows, setRows] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { rows } = await ApplicationApi.list({ owner })
      setRows(rows ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load applications')
    } finally {
      setLoading(false)
    }
  }, [owner])

  useEffect(() => {
    void load()
  }, [load])

  const onAdd = async () => {
    try {
      const a = newApplication(owner)
      await ApplicationApi.add(a)
      onOpen(a)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to add application')
    }
  }

  const onDelete = async (a: Application) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete application "${a.name}"?`)) return
    try {
      await ApplicationApi.remove(a)
      setRows((rs) => rs.filter((r) => r.name !== a.name))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete application')
    }
  }

  const columns: Column<Application>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (a) => (
        <Text fontSize="$3" color="$blue11" onPress={() => onOpen(a)} cursor="pointer">
          {a.name}
        </Text>
      ),
    },
    { key: 'displayName', header: 'Display name' },
    { key: 'template', header: 'Template', width: 150 },
    { key: 'namespace', header: 'Namespace', width: 200 },
    { key: 'status', header: 'Status', width: 130, render: (a) => <StatusTag status={a.status} /> },
    {
      key: 'action',
      header: '',
      width: 150,
      render: (a) => (
        <XStack gap="$2">
          <Button size="$2" onPress={() => onOpen(a)}>
            Edit
          </Button>
          <Button size="$2" theme="red" icon={<Trash size={14} />} onPress={() => void onDelete(a)} />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle="Deployed applications."
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
        rowKey={(a) => `${a.owner}/${a.name}`}
        empty="No applications yet. Click Add to create one."
      />
    </>
  )
}
