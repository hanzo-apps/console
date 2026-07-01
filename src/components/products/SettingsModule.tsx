'use client'

/**
 * Settings — organization configuration.
 *
 * The General tab reads the REAL signed-in account (`get-account`) and the active
 * organization (`get-organization` via the org-scoped `/org/iam` proxy, so an ORG
 * admin — not only a global admin — sees it). Branding shows the REAL per-host
 * runtime config the app resolved. Member management lives in Team and personal
 * account settings in Profile (one home each — this never duplicates them);
 * identity mutations are owned by IAM and deep-link there. Every read has honest
 * loading / 404 / access states; nothing is fabricated.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink, Users } from '@hanzogui/lucide-icons-2'

import { ApiError, TeamApi, type Organization } from '~/lib/api'
import { config } from '~/config'
import { currentOrg } from '~/lib/org-scope'
import { useSession } from '~/lib/auth/session'
import { PageHeader } from '~/components/ui/PageHeader'
import { FieldRow } from '~/components/ui/Field'
import { ErrorState, asApiError, type HonestCopy } from '~/components/ui/States'

const IAM_COPY: HonestCopy = {
  notFound:
    'IAM (/org/iam) is not routed on this host yet. It appears automatically once the deployment proxies it to Hanzo IAM.',
  unauthorized:
    'This requires an authorized session, enforced server-side by IAM. Sign in with an account that has access.',
}

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

function InfoRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  const text = value === undefined || value === null || value === '' ? '—' : String(value)
  const empty = text === '—'
  return (
    <FieldRow label={label}>
      <Text fontSize="$3" color={empty ? '$color10' : '$color12'} pt="$2">{text}</Text>
    </FieldRow>
  )
}

type Async<T> = { phase: 'loading' } | { phase: 'error'; err: ApiError } | { phase: 'ready'; data: T }

function useAsync<T>(fn: () => Promise<T>): { state: Async<T>; reload: () => void } {
  const [state, setState] = useState<Async<T>>({ phase: 'loading' })
  const reload = useCallback(() => {
    setState({ phase: 'loading' })
    fn()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [fn])
  useEffect(() => { reload() }, [reload])
  return { state, reload }
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <YStack gap="$2">
      <XStack items="center" justify="space-between">
        <Text fontSize="$5" fontWeight="700">{title}</Text>
        {action}
      </XStack>
      {children}
    </YStack>
  )
}

function ManageInIam() {
  return (
    <Button
      size="$2"
      icon={<ExternalLink size={15} />}
      onPress={() => { if (typeof window !== 'undefined') window.open(config.iamUrl, '_blank', 'noopener') }}
    >
      IAM console
    </Button>
  )
}

function GeneralTab() {
  const router = useRouter()
  const { account } = useSession()
  const org = currentOrg()
  const fetchOrg = useCallback(() => TeamApi.organization(org), [org])
  const { state, reload } = useAsync<Organization>(fetchOrg)

  return (
    <YStack gap="$5">
      <Section
        title="Organization"
        action={<Button size="$2" icon={<Users size={15} />} onPress={() => router.push('/team')}>Manage team</Button>}
      >
        {state.phase === 'error' ? (
          <ErrorState err={state.err} onRetry={reload} copy={IAM_COPY} />
        ) : state.phase === 'loading' ? (
          <XStack p="$6" justify="center"><Spinner size="large" color="$color11" /></XStack>
        ) : (
          <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
            <InfoRow label="Name" value={state.data.displayName || state.data.name} />
            <InfoRow label="Slug" value={state.data.name} />
            <InfoRow label="Website" value={state.data.websiteUrl} />
            <InfoRow label="Created" value={fmtDate(state.data.createdTime)} />
          </Card>
        )}
      </Section>

      <Section title="Your account">
        <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
          <InfoRow label="Email" value={account?.email} />
          <InfoRow label="Display name" value={account?.displayName} />
          <InfoRow label="Username" value={account?.name} />
        </Card>
        <Text fontSize="$2" color="$color10">
          Manage your identity, password, and 2FA in Profile → Security. Renaming the organization is
          managed in the IAM console.
        </Text>
      </Section>
    </YStack>
  )
}

function BrandingTab() {
  return (
    <YStack gap="$3">
      <Text fontSize="$3" color="$color10">
        The runtime branding resolved for this host. One console image serves every brand; these values
        come from the request hostname.
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

const TABS = [
  { id: '', label: 'General' },
  { id: 'branding', label: 'Branding' },
] as const

export function SettingsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = params.tab ?? ''
  const body = tab === 'branding' ? <BrandingTab /> : <GeneralTab />

  return (
    <>
      <PageHeader title="Settings" subtitle="Organization and account settings." actions={<ManageInIam />} />
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
