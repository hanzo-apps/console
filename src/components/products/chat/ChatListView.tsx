'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack } from '@hanzo/gui'
import { Trash } from '@hanzogui/lucide-icons-2'

import { ApiError, ChatApi, type Chat } from '~/lib/api'
import { useSession } from '~/lib/auth/session'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'

export function ChatListView({ onOpen }: { onOpen: (c: Chat) => void }) {
  const { account } = useSession()
  const user = account?.name ?? 'admin'

  const [rows, setRows] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { rows } = await ChatApi.list({ user })
      setRows(rows ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load chats')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const onDelete = async (c: Chat) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete chat "${c.name}"?`)) return
    try {
      await ChatApi.remove(c)
      setRows((rs) => rs.filter((r) => r.name !== c.name))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete chat')
    }
  }

  const columns: Column<Chat>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <Text fontSize="$3" color="$blue11" onPress={() => onOpen(c)} cursor="pointer">
          {c.displayName || c.name}
        </Text>
      ),
    },
    { key: 'user', header: 'User', width: 160 },
    { key: 'store', header: 'Store', width: 160 },
    { key: 'messageCount', header: 'Messages', width: 110 },
    { key: 'updatedTime', header: 'Updated', width: 200 },
    {
      key: 'action',
      header: '',
      width: 150,
      render: (c) => (
        <XStack gap="$2">
          <Button size="$2" onPress={() => onOpen(c)}>
            View
          </Button>
          <Button size="$2" theme="red" icon={<Trash size={14} />} onPress={() => void onDelete(c)} />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Chat" subtitle="Chat sessions and history." />
      {error ? <Text color="$red10">{error}</Text> : null}
      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(c) => `${c.owner}/${c.name}`}
        empty="No chats yet."
      />
    </>
  )
}
