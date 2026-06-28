'use client'

/**
 * Settings — account, organization, API keys, and branding in one tabbed module.
 *
 * Consolidates hanzoai/console's org/project/account settings pages onto the
 * surfaces console2 actually has: the General tab reads the REAL signed-in
 * account (`get-account`) and organization (`/v1/iam/get-organization`); Members
 * reads the REAL `/v1/iam/get-users`; API Keys embeds the shared `ApiKeysView`;
 * Branding shows the REAL per-host runtime config the app resolved. Identity
 * mutations (rename, invite, roles) are owned by IAM — this deep-links there
 * rather than re-implementing them. Every read has honest loading/404/401/503
 * states; nothing is fabricated.
 *
 * The tab is the route param (`/settings`, `/settings/api-keys`, …), mirroring
 * the IamModule param branch.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink } from '@hanzogui/lucide-icons-2'

import { ApiError, IamAdminApi, type Organization, type IamUser } from '~/lib/api'
import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { PageHeader } from '~/components/ui/PageHeader'
import { FieldRow } from '~/components/ui/Field'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError, type HonestCopy } from '~/components/ui/States'
import { ApiKeysView } from './ApiKeysModule'

const IAM_COPY: HonestCopy = {
  notFound:
    'IAM (/v1/iam) is not routed on this host yet. It appears automatically once the deployment proxies /v1/iam to Hanzo IAM.',
  unauthorized:
    'This requires an authorized session, enforced server-side by IAM. Sign in with an account that has access.',
}

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

/** A labeled read-only value row; renders a dim em-dash when empty. */
function InfoRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  const text =
    value === undefined || value === null || value === '' ? '—' : String(value)
  const empty = text === '—'
  return (
    <FieldRow label={label}>
      <Text fontSize="$3" color={empty ? '$color10' : '$color12'} pt="$2">
        {text}
      </Text>
    </FieldRow>
  )
}

// ── Generic async load ────────────────────────────────────────────────────────

type Async<T> = { phase: 'loading' } | { phase: 'error'; err: ApiError } | { phase: 'ready'; data: T }

/** Run a memoized fetcher into an honest async state, with a reload. */
function useAsync<T>(fn: () => Promise<T>): { state: Async<T>; reload: () => void } {
  const [state, setState] = useState<Async<T>>({ phase: 'loading' })
  const reload = useCallback(() => {
    setState({ phase: 'loading' })
    fn()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [fn])
  useEffect(() => {
    reload()
  }, [reload])
  return { state, reload }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <YStack gap="$2">
      <Text fontSize="$5" fontWeight="700">
        {title}
      </Text>
      {children}
    </YStack>
  )
}

function ManageInIam() {
  return (
    <Button
      size="$2"
      icon={<ExternalLink size={15} />}
      onPress={() => {
        if (typeof window !== 'undefined') window.open(config.iamUrl, '_blank', 'noopener')
      }}
    >
      IAM console
    </Button>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function GeneralTab() {
  const { account } = useSession()
  const orgName = config.iamOrgName
  const fetchOrg = useCallback(() => IamAdminApi.organization(orgName), [orgName])
  const { state, reload } = useAsync<Organization>(fetchOrg)

  return (
    <YStack gap="$5">
      <Section title="Account">
        <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
          <InfoRow label="Email" value={account?.email} />
          <InfoRow label="Display name" value={account?.displayName} />
          <InfoRow label="Username" value={account?.name} />
          <InfoRow label="Organization" value={account?.organization} />
          <InfoRow label="Admin" value={account?.isAdmin ? 'yes' : 'no'} />
        </Card>
      </Section>

      <Section title="Organization">
        {state.phase === 'error' ? (
          <ErrorState err={state.err} onRetry={reload} copy={IAM_COPY} />
        ) : state.phase === 'loading' ? (
          <XStack p="$6" justify="center">
            <Spinner size="large" color="$color11" />
          </XStack>
        ) : (
          <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
            <InfoRow label="Name" value={state.data.name} />
            <InfoRow label="Display name" value={state.data.displayName} />
            <InfoRow label="Website" value={state.data.websiteUrl} />
            <InfoRow label="Created" value={fmtDate(state.data.createdTime)} />
          </Card>
        )}
      </Section>

      <Text fontSize="$3" color="$color10">
        Rename the organization, invite members, and manage roles in the IAM
        console — identity is owned by Hanzo IAM.
      </Text>
    </YStack>
  )
}

const memberColumns: Column<IamUser>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (u) => (
      <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
        {u.displayName || u.name}
      </Text>
    ),
  },
  { key: 'email', header: 'Email', render: (u) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{u.email || '—'}</Text> },
  {
    key: 'role',
    header: 'Role',
    width: 120,
    render: (u) => (
      <Text
        fontSize="$2"
        px="$2"
        py="$1"
        rounded="$2"
        bg={u.isAdmin ? '$color5' : '$color3'}
        color={u.isAdmin ? '$color12' : '$color11'}
      >
        {u.isAdmin ? 'admin' : u.type || 'member'}
      </Text>
    ),
  },
]

function MembersTab() {
  const orgName = config.iamOrgName
  const fetchUsers = useCallback(() => IamAdminApi.users(orgName), [orgName])
  const { state, reload } = useAsync(fetchUsers)

  if (state.phase === 'error') {
    return <ErrorState err={state.err} onRetry={reload} copy={IAM_COPY} />
  }
  return (
    <DataTable
      columns={memberColumns}
      rows={state.phase === 'ready' ? state.data.rows : []}
      loading={state.phase === 'loading'}
      rowKey={(u) => `${u.owner}/${u.name}`}
      empty="No members in this organization."
    />
  )
}

function BrandingTab() {
  return (
    <YStack gap="$3">
      <Text fontSize="$3" color="$color10">
        The runtime branding resolved for this host. One console image serves
        every brand; these values come from the request hostname.
      </Text>
      <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
        <InfoRow label="Brand" value={config.brand} />
        <InfoRow label="Name" value={config.brandName} />
        <InfoRow label="IAM issuer" value={config.iamUrl} />
        <InfoRow label="IAM organization" value={config.iamOrgName} />
        <InfoRow label="IAM application" value={config.iamAppName} />
        <InfoRow label="Cloud API" value={config.cloudUrl} />
        <InfoRow label="Platform" value={config.platformUrl} />
        <InfoRow label="Billing" value={config.billingUrl} />
      </Card>
    </YStack>
  )
}

// ── Module ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: '', label: 'General' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'members', label: 'Members' },
  { id: 'branding', label: 'Branding' },
] as const

export function SettingsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = params.tab ?? ''

  const body =
    tab === 'api-keys' ? (
      <ApiKeysView />
    ) : tab === 'members' ? (
      <MembersTab />
    ) : tab === 'branding' ? (
      <BrandingTab />
    ) : (
      <GeneralTab />
    )

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Account, organization, API keys, and branding."
        actions={<ManageInIam />}
      />
      <XStack gap="$1" flexWrap="wrap">
        {TABS.map((t) => (
          <Button
            key={t.id || 'general'}
            size="$2"
            bg={t.id === tab ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => router.push(t.id ? `/settings/${t.id}` : '/settings')}
          >
            {t.label}
          </Button>
        ))}
      </XStack>
      {body}
    </>
  )
}
