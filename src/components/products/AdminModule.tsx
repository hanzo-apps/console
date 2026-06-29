'use client'

/**
 * Identity & access admin — Organizations, Users, Roles (RBAC), and the Audit
 * trail, served by Hanzo IAM under `/v1/iam/*` (HIP-0111). ONE generic list view
 * (`AdminListView`) drives every surface over the shared cookie `/v1` envelope
 * client; the tabbed `IamModule` and the standalone `AuditModule` just supply a
 * fetcher + columns. No data is ever fabricated: loading, not-available (404),
 * access-required (401/403/unauthorized), error, and empty are all honest states.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Text, XStack } from '@hanzo/gui'
import { RefreshCw, ExternalLink } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import {
  IamAdminApi,
  type Paged,
  type Organization,
  type IamUser,
  type Role,
  type AuditRecord,
} from '~/lib/api/admin'
import { config } from '~/config'
import { currentOrg } from '~/lib/org-scope'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError, type HonestCopy } from '~/components/ui/States'

/** IAM-specific guidance for the honest 404 / unauthorized states. */
const IAM_COPY: HonestCopy = {
  notFound:
    'The IAM admin API (/v1/iam) is not routed on this host yet. It appears automatically once the deployment proxies /v1/iam to Hanzo IAM.',
  unauthorized:
    'This view requires an admin session. Access is enforced server-side by IAM — sign in with an account that has the right role.',
}

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

const dim = (v?: string | number | null) =>
  v === undefined || v === null || v === '' ? (
    <Text fontSize="$3" color="$color10">
      —
    </Text>
  ) : (
    <Text fontSize="$3" color="$color11" numberOfLines={1}>
      {String(v)}
    </Text>
  )

type LoadState<T> = { phase: 'loading' } | { phase: 'error'; err: ApiError } | { phase: 'ready'; rows: T[] }

/** Generic admin list: runs a fetcher, renders an honest state, then a table. */
function AdminListView<T>({
  fetcher,
  columns,
  rowKey,
  empty,
}: {
  fetcher: () => Promise<Paged<T>>
  columns: Column<T>[]
  rowKey: (r: T) => string
  empty: string
}) {
  const [state, setState] = useState<LoadState<T>>({ phase: 'loading' })

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    fetcher()
      .then((p) => setState({ phase: 'ready', rows: p.rows ?? [] }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [fetcher])

  useEffect(() => {
    run()
  }, [run])

  return (
    <>
      <XStack justify="flex-end">
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>
          Refresh
        </Button>
      </XStack>
      {state.phase === 'error' ? (
        <ErrorState err={state.err} onRetry={run} copy={IAM_COPY} />
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.rows : []}
          loading={state.phase === 'loading'}
          rowKey={rowKey}
          empty={empty}
        />
      )}
    </>
  )
}

/** A "manage in the full IAM app" deep-link, shown in the admin headers. */
function ManageInIam() {
  return (
    <Button
      icon={<ExternalLink size={15} />}
      onPress={() => {
        if (typeof window !== 'undefined') window.open(config.iamUrl, '_blank', 'noopener')
      }}
    >
      IAM console
    </Button>
  )
}

// ── Column sets ──────────────────────────────────────────────────────────────

const orgColumns: Column<Organization>[] = [
  { key: 'name', header: 'Name', render: (o) => <Text fontSize="$3" fontWeight="600">{o.name}</Text> },
  { key: 'displayName', header: 'Display name', render: (o) => dim(o.displayName) },
  { key: 'websiteUrl', header: 'Website', width: 220, render: (o) => dim(o.websiteUrl) },
  { key: 'createdTime', header: 'Created', width: 200, render: (o) => dim(fmtDate(o.createdTime)) },
]

const userColumns: Column<IamUser>[] = [
  { key: 'name', header: 'Name', render: (u) => <Text fontSize="$3" fontWeight="600">{u.name}</Text> },
  { key: 'displayName', header: 'Display name', render: (u) => dim(u.displayName) },
  { key: 'email', header: 'Email', render: (u) => dim(u.email) },
  {
    key: 'role',
    header: 'Role',
    width: 110,
    render: (u) => (
      <Text fontSize="$2" px="$2" py="$1" rounded="$2" bg={u.isAdmin ? '$color5' : '$color3'} color={u.isAdmin ? '$color12' : '$color11'}>
        {u.isAdmin ? 'admin' : u.type || 'member'}
      </Text>
    ),
  },
  { key: 'createdTime', header: 'Created', width: 200, render: (u) => dim(fmtDate(u.createdTime)) },
]

const roleColumns: Column<Role>[] = [
  { key: 'name', header: 'Name', render: (r) => <Text fontSize="$3" fontWeight="600">{r.name}</Text> },
  { key: 'displayName', header: 'Display name', render: (r) => dim(r.displayName) },
  { key: 'members', header: 'Members', width: 100, render: (r) => dim(r.users?.length ?? 0) },
  {
    key: 'isEnabled',
    header: 'Enabled',
    width: 100,
    render: (r) => dim(r.isEnabled === false ? 'no' : 'yes'),
  },
  { key: 'createdTime', header: 'Created', width: 200, render: (r) => dim(fmtDate(r.createdTime)) },
]

const recordColumns: Column<AuditRecord>[] = [
  { key: 'createdTime', header: 'Time', width: 200, render: (r) => dim(fmtDate(r.createdTime)) },
  { key: 'user', header: 'User', render: (r) => dim(r.user) },
  { key: 'action', header: 'Action', width: 150, render: (r) => dim(r.action) },
  {
    key: 'request',
    header: 'Request',
    render: (r) => dim([r.method, r.requestUri].filter(Boolean).join(' ')),
  },
  { key: 'clientIp', header: 'IP', width: 140, render: (r) => dim(r.clientIp) },
]

// ── Modules ──────────────────────────────────────────────────────────────────

const IAM_TABS = [
  { id: '', label: 'Organizations' },
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles' },
] as const

/**
 * Identity & access — Organizations, Users, Roles in one tabbed module. The tab
 * is the route param (`/iam`, `/iam/users`, `/iam/roles`), mirroring the
 * ProvidersModule param branch.
 */
export function IamModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = params.tab ?? ''
  // The ACTIVE org scope (the brand org, or the org a global admin switched to);
  // users/roles below are read for it. The org LIST itself is unscoped — a global
  // admin sees every org (what powers the switcher).
  const org = currentOrg()

  const orgFetcher = useCallback(() => IamAdminApi.organizations(), [])
  const userFetcher = useCallback(() => IamAdminApi.users(org), [org])
  const roleFetcher = useCallback(() => IamAdminApi.roles(org), [org])

  const view = useMemo(() => {
    if (tab === 'users')
      return <AdminListView key="users" fetcher={userFetcher} columns={userColumns} rowKey={(u) => `${u.owner}/${u.name}`} empty="No users in this organization." />
    if (tab === 'roles')
      return <AdminListView key="roles" fetcher={roleFetcher} columns={roleColumns} rowKey={(r) => `${r.owner}/${r.name}`} empty="No roles defined yet." />
    return <AdminListView key="orgs" fetcher={orgFetcher} columns={orgColumns} rowKey={(o) => `${o.owner}/${o.name}`} empty="No organizations visible to this account." />
  }, [tab, orgFetcher, userFetcher, roleFetcher])

  return (
    <>
      <PageHeader
        title="Identity & Access"
        subtitle="Organizations, users, and roles (RBAC), served by Hanzo IAM."
        actions={<ManageInIam />}
      />
      <XStack gap="$1" flexWrap="wrap">
        {IAM_TABS.map((t) => (
          <Button
            key={t.id || 'orgs'}
            size="$2"
            bg={t.id === tab ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => router.push(t.id ? `/iam/${t.id}` : '/iam')}
          >
            {t.label}
          </Button>
        ))}
      </XStack>
      {view}
    </>
  )
}

/** Audit — the identity & access event log (`/v1/iam/get-records`). */
export function AuditModule(_props: { params: Record<string, string> }) {
  const org = currentOrg()
  const fetcher = useCallback(() => IamAdminApi.records(org), [org])
  return (
    <>
      <PageHeader
        title="Audit"
        subtitle="Identity and access events recorded by Hanzo IAM."
        actions={<ManageInIam />}
      />
      <AdminListView
        fetcher={fetcher}
        columns={recordColumns}
        rowKey={(r) => String(r.id ?? `${r.createdTime ?? ''}-${r.user ?? ''}-${r.requestUri ?? ''}`)}
        empty="No audit events recorded yet."
      />
    </>
  )
}
