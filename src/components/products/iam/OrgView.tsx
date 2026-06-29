'use client'

/**
 * IAM organization detail = its MEMBERSHIPS — the org's users with role/isAdmin
 * and 2FA, read via `get-users?owner=<org>` through the gated proxy (a non-global
 * admin may only open their own org). Organization create/delete is intentionally
 * NOT here: the admin proxy allow-lists user/application/provider mutations only,
 * so org lifecycle stays in the full IAM console (the header deep-link) where it
 * is a global-admin operation.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { ApiError, IamAdminApi, type IamUser } from '~/lib/api'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { PageHeader } from '~/components/ui/PageHeader'
import { mfaLabel, roleLabel } from './logic'

const RoleTag = ({ u }: { u: IamUser }) => (
  <Text
    fontSize="$2"
    px="$2"
    py="$1"
    rounded="$2"
    bg={u.isAdmin ? '$color5' : '$color3'}
    color={u.isAdmin ? '$color12' : '$color11'}
  >
    {roleLabel(u)}
  </Text>
)

const memberColumns: Column<IamUser>[] = [
  { key: 'name', header: 'Name', render: (u) => <Text fontSize="$3" fontWeight="600">{u.name}</Text> },
  { key: 'email', header: 'Email', render: (u) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{u.email || '—'}</Text> },
  { key: 'role', header: 'Role', width: 110, render: (u) => <RoleTag u={u} /> },
  { key: 'mfa', header: '2FA', width: 90, render: (u) => <Text fontSize="$3" color="$color11">{mfaLabel(u)}</Text> },
]

type LoadState = { phase: 'loading' } | { phase: 'error'; err: ApiError } | { phase: 'ready'; rows: IamUser[] }

export function OrgView({ name, onDone }: { name: string; onDone: () => void }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    IamAdminApi.users(name)
      .then((p) => setState({ phase: 'ready', rows: p.rows ?? [] }))
      .catch((e) => setState({ phase: 'error', err: e instanceof ApiError ? e : new ApiError(String(e)) }))
  }, [name])

  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <PageHeader
        title={name}
        subtitle="Organization memberships"
        actions={
          <XStack gap="$2">
            <Button icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <Button onPress={onDone}>Back</Button>
          </XStack>
        }
      />
      {state.phase === 'error' ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={620}>
          <Text fontSize="$4" fontWeight="700">
            Could not load memberships
          </Text>
          <Text fontSize="$3" color="$color11">
            {state.err.message}
          </Text>
          <Button size="$2" self="flex-start" onPress={load}>
            Retry
          </Button>
        </Card>
      ) : (
        <DataTable
          columns={memberColumns}
          rows={state.phase === 'ready' ? state.rows : []}
          loading={state.phase === 'loading'}
          rowKey={(u) => `${u.owner}/${u.name}`}
          empty="No members in this organization."
        />
      )}
    </>
  )
}
