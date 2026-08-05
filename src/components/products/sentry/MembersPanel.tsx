'use client'

/**
 * Members — the org + its members + roles for the Sentry face, COMPOSED from the
 * console's existing Hanzo IAM surface (`TeamApi` over the own-org `/org/iam`
 * proxy). Identity is NOT reimplemented here: this is a read view over the same
 * org/members/roles the console's Team settings manage, so a Sentry admin sees who
 * has access. Management (invite/role/remove) hands off to the one Team module.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Building2, RefreshCw, Settings2, Users } from '@hanzogui/lucide-icons-2'

import { TeamApi } from '~/lib/api/team'
import type { IamUser, Organization, Role } from '~/lib/api/admin'
import { currentOrg } from '~/lib/org-scope'
import { MetricCard } from '~/components/ui/Metric'
import { ErrorState, asApiError } from '~/components/ui/States'
import { Pill, Fact } from './parts'
import { fmtDateTime } from './logic'
import { toneColor, toneVar } from '~/components/ui/tone'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

type Data = { org: Organization | null; members: IamUser[]; roles: Role[] }
type State = { phase: 'loading' } | { phase: 'error'; error: unknown } | { phase: 'ready'; data: Data }

const roleLabel = (u: IamUser): string => (u.isAdmin ? 'Admin' : 'Member')
const memberName = (u: IamUser): string => u.displayName || u.name

export function MembersPanel() {
  const router = useRouter()
  const [state, setState] = useState<State>({ phase: 'loading' })
  const orgName = currentOrg()

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const [org, members, roles] = await Promise.all([
        TeamApi.organization(orgName).catch(() => null),
        TeamApi.members(orgName).then((p) => p.rows).catch(() => [] as IamUser[]),
        TeamApi.roles(orgName).then((p) => p.rows).catch(() => [] as Role[]),
      ])
      setState({ phase: 'ready', data: { org, members, roles } })
    } catch (e) {
      setState({ phase: 'error', error: e })
    }
  }, [orgName])

  useEffect(() => {
    void load()
  }, [load])

  const data = state.phase === 'ready' ? state.data : { org: null, members: [], roles: [] }
  const admins = data.members.filter((m) => m.isAdmin).length

  const columns: Column<IamUser>[] = [
    { key: 'name', header: 'Member', render: (u) => (
      <YStack minW={0}>
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{memberName(u)}</Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1} className="hz-mono">{u.owner}/{u.name}</Text>
      </YStack>
    ) },
    { key: 'email', header: 'Email', render: (u) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{u.email || '—'}</Text> },
    { key: 'role', header: 'Role', width: 120, render: (u) => <Pill label={roleLabel(u)} tone={toneVar(u.isAdmin ? 'warning' : 'neutral')} /> },
    { key: 'createdTime', header: 'Joined', width: 150, render: (u) => <Text fontSize="$2" color="$color11">{u.createdTime ? fmtDateTime(u.createdTime) : '—'}</Text> },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title="Members"
        subtitle="Who has access to this organization’s Sentry — from your Hanzo IAM org."
        actions={
          <XStack gap="$2">
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={() => void load()}>
              Refresh
            </Button>
            <Button size="$3" icon={<Settings2 size={15} />} onPress={() => router.push('/team')}>
              Manage members
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <ErrorState err={asApiError(state.error)} onRetry={() => void load()} />
      ) : (
        <>
          <XStack gap="$3" flexWrap="wrap">
            <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" flex={1} minW={220}>
              <XStack items="center" gap="$2">
                <Building2 size={16} color="var(--color11)" />
                <Text fontSize="$2" color="$color11" fontWeight="500">
                  Organization
                </Text>
              </XStack>
              <Text fontSize="$6" fontWeight="600" color="$color12" numberOfLines={1}>
                {data.org?.displayName || data.org?.name || orgName}
              </Text>
              <XStack gap="$4" flexWrap="wrap">
                <Fact label="Org id" value={data.org?.name || orgName} />
                {data.org?.createdTime ? <Fact label="Created" value={fmtDateTime(data.org.createdTime)} /> : null}
              </XStack>
            </Card>
            <MetricCard icon={<Users size={16} color={toneColor('neutral')} />} label="Members" value={String(data.members.length)} />
            <MetricCard icon={<Users size={16} color={toneColor('warning')} />} label="Admins" value={String(admins)} />
            <MetricCard icon={<Users size={16} color={toneColor('muted')} />} label="Roles" value={String(data.roles.length)} />
          </XStack>

          <YStack gap="$2">
            <Text fontSize="$4" fontWeight="600" color="$color12">
              People
            </Text>
            <DataTable<IamUser>
              columns={columns}
              rows={data.members}
              loading={state.phase === 'loading'}
              rowKey={(u) => `${u.owner}/${u.name}`}
              empty="No members found for this organization."
            />
          </YStack>

          {data.roles.length > 0 ? (
            <YStack gap="$2">
              <Text fontSize="$4" fontWeight="600" color="$color12">
                Roles
              </Text>
              <XStack gap="$2" flexWrap="wrap">
                {data.roles.map((r) => (
                  <XStack key={`${r.owner}/${r.name}`} borderWidth={1} borderColor="$borderColor" rounded="$3" px="$3" py="$2" gap="$2" items="center">
                    <Text fontSize="$2" color="$color12" fontWeight="500">
                      {r.displayName || r.name}
                    </Text>
                    <Text fontSize="$1" color="$color10">
                      {(r.users?.length ?? 0)} {(r.users?.length ?? 0) === 1 ? 'member' : 'members'}
                    </Text>
                  </XStack>
                ))}
              </XStack>
            </YStack>
          ) : null}
        </>
      )}
    </YStack>
  )
}
