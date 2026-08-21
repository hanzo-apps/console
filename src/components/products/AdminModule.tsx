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
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, ExternalLink, Plus, Trash2, ShieldCheck, ShieldOff } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import {
  IamAdminApi,
  type Paged,
  type Organization,
  type IamUser,
  type Role,
} from '~/lib/api/admin'
import { config } from '~/config'
import { currentOrg } from '~/lib/org-scope'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldRow, FieldText } from '~/components/ui/Field'
import { ErrorState, asApiError, isForbidden, SuperAdminRequired, type HonestCopy } from '~/components/ui/States'

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

type Tone = { tone: 'ok' | 'err'; text: string }

/**
 * Users with full CRUD — create, promote/demote admin, and delete — over the
 * ready IamAdminApi mutations (add/update/delete a user) through the server-gated
 * /admin/iam proxy, scoped to `owner`. This is the IAM user surface, in
 * console: no link-out for the common lifecycle. Honest states throughout.
 */
function UsersAdminView({ owner }: { owner: string }) {
  const [state, setState] = useState<LoadState<IamUser>>({ phase: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<Tone | null>(null)

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    IamAdminApi.users(owner)
      .then((p) => setState({ phase: 'ready', rows: p.rows ?? [] }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [owner])

  useEffect(() => {
    run()
  }, [run])

  const create = useCallback(async () => {
    if (!name.trim() || !password) {
      setMsg({ tone: 'err', text: 'Name and password are required.' })
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      await IamAdminApi.addUser({ owner, name: name.trim(), email: email.trim(), password } as IamUser)
      setMsg({ tone: 'ok', text: `Created ${owner}/${name.trim()}.` })
      setName('')
      setEmail('')
      setPassword('')
      run()
    } catch (e) {
      setMsg({ tone: 'err', text: asApiError(e).message })
    } finally {
      setSaving(false)
    }
  }, [owner, name, email, password, run])

  const toggleAdmin = useCallback(
    async (u: IamUser) => {
      const k = `${u.owner}/${u.name}`
      setBusy(k)
      try {
        await IamAdminApi.updateUser({ ...u, isAdmin: !u.isAdmin })
        run()
      } catch (e) {
        setState({ phase: 'error', err: asApiError(e) })
      } finally {
        setBusy(null)
      }
    },
    [run],
  )

  const remove = useCallback(
    async (u: IamUser) => {
      if (typeof window !== 'undefined' && !window.confirm(`Delete user ${u.owner}/${u.name}? This cannot be undone.`)) return
      const k = `${u.owner}/${u.name}`
      setBusy(k)
      try {
        await IamAdminApi.deleteUser(u)
        run()
      } catch (e) {
        setState({ phase: 'error', err: asApiError(e) })
      } finally {
        setBusy(null)
      }
    },
    [run],
  )

  const crudColumns: Column<IamUser>[] = [
    ...userColumns,
    {
      key: 'actions',
      header: '',
      width: 120,
      render: (u) => {
        const k = `${u.owner}/${u.name}`
        return (
          <XStack gap="$1.5">
            <Button
              size="$1"
              chromeless
              icon={u.isAdmin ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
              disabled={busy === k}
              onPress={() => void toggleAdmin(u)}
            />
            <Button size="$1" chromeless icon={<Trash2 size={14} />} disabled={busy === k} onPress={() => void remove(u)} />
          </XStack>
        )
      },
    },
  ]

  return (
    <>
      <XStack justify="flex-end" gap="$2">
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>Refresh</Button>
        <Button size="$2" icon={<Plus size={15} />} onPress={() => setShowForm((v) => !v)}>New user</Button>
      </XStack>

      {showForm && (
        <Card p="$3.5" gap="$2.5" borderWidth={1} borderColor="$borderColor" maxWidth={820}>
          <Text fontSize="$4" fontWeight="700">New user in {owner}</Text>
          <FieldRow label="Name"><FieldText value={name} onChange={setName} placeholder="jdoe" disabled={saving} /></FieldRow>
          <FieldRow label="Email"><FieldText value={email} onChange={setEmail} placeholder="jdoe@hanzo.ai" disabled={saving} /></FieldRow>
          <FieldRow label="Password"><FieldText value={password} onChange={setPassword} placeholder="initial password" secure disabled={saving} /></FieldRow>
          <XStack gap="$2" items="center">
            <Button self="flex-start" icon={<Plus size={15} />} disabled={saving} onPress={() => void create()}>
              {saving ? 'Creating…' : 'Create user'}
            </Button>
            {msg && <Text fontSize="$2" color={msg.tone === 'ok' ? '$green10' : '$red10'}>{msg.text}</Text>}
          </XStack>
          <Text fontSize="$2" color="$color10">Password is hashed by IAM (argon2id). The shield toggles global-admin.</Text>
        </Card>
      )}

      {state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <SuperAdminRequired />
        ) : (
          <ErrorState err={state.err} onRetry={run} copy={IAM_COPY} />
        )
      ) : (
        <DataTable
          columns={crudColumns}
          rows={state.phase === 'ready' ? state.rows : []}
          loading={state.phase === 'loading'}
          rowKey={(u) => `${u.owner}/${u.name}`}
          empty="No users in this organization."
        />
      )}
    </>
  )
}

/**
 * Roles with full CRUD — create and delete RBAC roles over IamAdminApi
 * (add/update/delete a role → /v1/iam/roles*), scoped to `owner`. Mirrors
 * UsersAdminView; membership editing stays in the full IAM app.
 */
function RolesAdminView({ owner }: { owner: string }) {
  const [state, setState] = useState<LoadState<Role>>({ phase: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<Tone | null>(null)

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    IamAdminApi.roles(owner)
      .then((p) => setState({ phase: 'ready', rows: p.rows ?? [] }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [owner])

  useEffect(() => {
    run()
  }, [run])

  const create = useCallback(async () => {
    if (!name.trim()) {
      setMsg({ tone: 'err', text: 'Name is required.' })
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      await IamAdminApi.addRole({ owner, name: name.trim(), displayName: displayName.trim() || name.trim(), isEnabled: true } as Role)
      setMsg({ tone: 'ok', text: `Created role ${owner}/${name.trim()}.` })
      setName('')
      setDisplayName('')
      run()
    } catch (e) {
      setMsg({ tone: 'err', text: asApiError(e).message })
    } finally {
      setSaving(false)
    }
  }, [owner, name, displayName, run])

  const remove = useCallback(
    async (r: Role) => {
      if (typeof window !== 'undefined' && !window.confirm(`Delete role ${r.owner}/${r.name}? This cannot be undone.`)) return
      const k = `${r.owner}/${r.name}`
      setBusy(k)
      try {
        await IamAdminApi.deleteRole(r)
        run()
      } catch (e) {
        setState({ phase: 'error', err: asApiError(e) })
      } finally {
        setBusy(null)
      }
    },
    [run],
  )

  const crudColumns: Column<Role>[] = [
    ...roleColumns,
    {
      key: 'actions',
      header: '',
      width: 60,
      render: (r) => {
        const k = `${r.owner}/${r.name}`
        return <Button size="$1" chromeless icon={<Trash2 size={14} />} disabled={busy === k} onPress={() => void remove(r)} />
      },
    },
  ]

  return (
    <>
      <XStack justify="flex-end" gap="$2">
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>Refresh</Button>
        <Button size="$2" icon={<Plus size={15} />} onPress={() => setShowForm((v) => !v)}>New role</Button>
      </XStack>

      {showForm && (
        <Card p="$3.5" gap="$2.5" borderWidth={1} borderColor="$borderColor" maxWidth={820}>
          <Text fontSize="$4" fontWeight="700">New role in {owner}</Text>
          <FieldRow label="Name"><FieldText value={name} onChange={setName} placeholder="deployers" disabled={saving} /></FieldRow>
          <FieldRow label="Display name"><FieldText value={displayName} onChange={setDisplayName} placeholder="Deployers" disabled={saving} /></FieldRow>
          <XStack gap="$2" items="center">
            <Button self="flex-start" icon={<Plus size={15} />} disabled={saving} onPress={() => void create()}>
              {saving ? 'Creating…' : 'Create role'}
            </Button>
            {msg && <Text fontSize="$2" color={msg.tone === 'ok' ? '$green10' : '$red10'}>{msg.text}</Text>}
          </XStack>
          <Text fontSize="$2" color="$color10">Assign members in the full IAM app; this manages the role itself.</Text>
        </Card>
      )}

      {state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <SuperAdminRequired />
        ) : (
          <ErrorState err={state.err} onRetry={run} copy={IAM_COPY} />
        )
      ) : (
        <DataTable
          columns={crudColumns}
          rows={state.phase === 'ready' ? state.rows : []}
          loading={state.phase === 'loading'}
          rowKey={(r) => `${r.owner}/${r.name}`}
          empty="No roles defined yet."
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

  const view = useMemo(() => {
    if (tab === 'users') return <UsersAdminView key="users" owner={org} />
    if (tab === 'roles') return <RolesAdminView key="roles" owner={org} />
    return <AdminListView key="orgs" fetcher={orgFetcher} columns={orgColumns} rowKey={(o) => `${o.owner}/${o.name}`} empty="No organizations visible to this account." />
  }, [tab, org, orgFetcher])

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

// The org-scoped Audit trail moved to its own enterprise view (filters, pagination,
// a per-event detail drawer with hash-chain evidence, CSV export) backed by cloud's
// tamper-evident store — see components/products/audit/AuditModule.tsx.
