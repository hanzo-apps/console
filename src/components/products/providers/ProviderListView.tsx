'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Plus, Trash } from '@hanzogui/lucide-icons-2'

import { ApiError, ProviderApi, type Provider } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { newProvider } from './logic'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

type ProviderRow = Provider & { _builtin?: boolean }

const StatusBadge = ({ on }: { on?: boolean }) => (
  <Text
    fontSize="$1" px="$2" py="$1" rounded="$2"
    bg={on ? '$green3' : '$color3'} color={on ? '$green11' : '$color11'}
  >
    {on ? 'Active' : 'OFF'}
  </Text>
)

export function ProviderListView({ onOpen }: { onOpen: (p: Provider) => void }) {
  // Tenant scope: casibase providers are owned by the ORG, not the username. Use
  // the active org scope (the same value stamped as X-Org-Id and switched by the
  // OrgSwitcher) so reads resolve the org's custom providers and a global admin's
  // org switch re-scopes (get-providers honors the owner param for admins).
  const owner = currentOrg()

  const [rows, setRows] = useState<ProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    // Load global (platform-key) + custom (per-org BYOK) providers independently so
    // one failing doesn't hide the other. But if BOTH fail, that's a real backend
    // error — surface it honestly instead of silently degrading to "No providers".
    const [globalOut, customOut] = await Promise.allSettled([
      ProviderApi.listGlobal(),
      ProviderApi.list({ owner }).then((r) => r.rows ?? []),
    ])
    if (globalOut.status === 'rejected' && customOut.status === 'rejected') {
      const e = globalOut.reason
      setError(e instanceof ApiError ? e.message : 'Neither the built-in nor your custom providers could be read. Reload the page to try again.')
      setRows([])
      setLoading(false)
      return
    }
    const globals: ProviderRow[] =
      globalOut.status === 'fulfilled' ? (globalOut.value ?? []).map((p) => ({ ...p, _builtin: true })) : []
    const custom: ProviderRow[] = customOut.status === 'fulfilled' ? customOut.value : []
    setRows([...globals, ...custom])
    setError(null)
    setLoading(false)
  }, [owner])

  useEffect(() => { void load() }, [load])

  const onAdd = async () => {
    try {
      const p = newProvider(owner)
      await ProviderApi.add(p)
      onOpen(p)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The provider was not created. Nothing was added — try again.')
    }
  }

  const onDelete = async (p: ProviderRow) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete provider "${p.name}"?`)) return
    try {
      await ProviderApi.remove(p)
      setRows(rs => rs.filter(r => r.name !== p.name || r._builtin))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `“${p.name}” was not deleted. It is still in the list — try again.`)
    }
  }

  const columns: Column<ProviderRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (p) => (
        <XStack gap="$2" items="center">
          <Text
            fontSize="$3" color="$color12"
            onPress={p._builtin ? undefined : () => onOpen(p)}
            cursor={p._builtin ? 'default' : 'pointer'}
          >
            {p.displayName || p.name}
          </Text>
          {p._builtin && (
            <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color12">
              Built-in
            </Text>
          )}
        </XStack>
      ),
    },
    { key: 'category', header: 'Category', width: 120 },
    { key: 'type',     header: 'Type',     width: 130 },
    { key: 'subType',  header: 'Sub type', width: 150 },
    {
      key: 'state',
      header: 'State',
      width: 100,
      render: p => <StatusBadge on={p._builtin || p.state === 'Active'} />,
    },
    {
      key: 'action',
      header: '',
      width: 120,
      render: (p) => p._builtin ? (
        <Text fontSize="$2" color="$color10">Managed</Text>
      ) : (
        <XStack gap="$2">
          <Button size="$2" onPress={() => onOpen(p)}>Edit</Button>
          <Button size="$2" icon={<Trash size={14} />} onPress={() => void onDelete(p)} />
        </XStack>
      ),
    },
  ]

  const builtinCount = rows.filter(r => r._builtin).length
  const customCount  = rows.filter(r => !r._builtin).length

  return (
    <>
      <PageHeader
        title="Providers"
        subtitle="Built-in providers are available to all users via Hanzo platform keys. Add custom providers per org to override or extend."
        actions={
          <Button icon={<Plus size={16} />} onPress={() => void onAdd()}>
            Add custom
          </Button>
        }
      />
      {error ? <Text color="$red10" mb="$2">{error}</Text> : null}
      {!loading && (
        <YStack mb="$2">
          <Text fontSize="$2" color="$color10">
            {builtinCount} built-in · {customCount} custom
          </Text>
        </YStack>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={p => `${p._builtin ? 'g' : 'c'}/${p.owner}/${p.name}`}
        empty="No providers. Click 'Add custom' to add one."
      />
    </>
  )
}
