'use client'

/**
 * Profile — the signed-in user's own account.
 *
 * Reads the REAL account from the session (`get-account`): identity, email, org,
 * and role. Identity mutations (name, password, 2FA) are owned by Hanzo IAM — this
 * deep-links there rather than re-implementing them (never a plaintext password
 * here). The API Keys tab embeds the shared per-user `hk-` credential surface.
 * Reached from the footer wallet's user row; also carries Sign out.
 */
import { useRouter } from 'next/navigation'
import { Avatar, Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink, LogOut, ShieldCheck } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { PageHeader } from '~/components/ui/PageHeader'
import { FieldRow } from '~/components/ui/Field'
import { ApiKeysView } from './ApiKeysModule'

/** A labeled read-only value row; dim em-dash when empty. */
function InfoRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  const text = value === undefined || value === null || value === '' ? '—' : String(value)
  const empty = text === '—'
  return (
    <FieldRow label={label}>
      <Text fontSize="$3" color={empty ? '$color10' : '$color12'} pt="$2">{text}</Text>
    </FieldRow>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function ManageInIam({ label = 'Edit in IAM' }: { label?: string }) {
  return (
    <Button
      size="$2"
      icon={<ExternalLink size={15} />}
      onPress={() => { if (typeof window !== 'undefined') window.open(config.iamUrl, '_blank', 'noopener') }}
    >
      {label}
    </Button>
  )
}

function AccountTab() {
  const { account, signOut } = useSession()
  const name = account?.displayName || account?.name || 'Account'
  const avatar = typeof account?.avatar === 'string' ? account.avatar : undefined

  return (
    <YStack gap="$5">
      <Card p="$4" gap="$4" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
        <XStack gap="$3" items="center">
          <Avatar circular size={56}>
            {avatar ? <Avatar.Image accessibilityLabel={name} src={avatar} /> : null}
            <Avatar.Fallback bg="$color5" items="center" justify="center">
              <Text fontSize="$5" fontWeight="800" color="$color12">{initials(name)}</Text>
            </Avatar.Fallback>
          </Avatar>
          <YStack flex={1}>
            <Text fontSize="$6" fontWeight="800" color="$color12">{name}</Text>
            <Text fontSize="$3" color="$color11">{account?.email || '—'}</Text>
          </YStack>
          <ManageInIam />
        </XStack>
        <YStack gap="$3.5">
          <InfoRow label="Username" value={account?.name} />
          <InfoRow label="Organization" value={account?.organization || account?.owner} />
          <InfoRow label="Role" value={account?.isAdmin ? 'Organization admin' : 'Member'} />
        </YStack>
      </Card>

      <XStack>
        <Button icon={<LogOut size={16} />} onPress={() => void signOut()}>Sign out</Button>
      </XStack>
    </YStack>
  )
}

function SecurityTab() {
  return (
    <YStack gap="$4" maxW={720}>
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$2" items="center">
          <ShieldCheck size={18} />
          <Text fontSize="$5" fontWeight="700">Password &amp; two-factor</Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          Your password and 2FA are managed by Hanzo IAM — never stored here. Update them in the
          identity console; changes apply to every {config.brandName} product you sign in to.
        </Text>
        <XStack>
          <ManageInIam label="Manage security in IAM" />
        </XStack>
      </Card>
    </YStack>
  )
}

const TABS = [
  { id: '', label: 'Account' },
  { id: 'security', label: 'Security' },
  { id: 'keys', label: 'API Keys' },
] as const

export function ProfileModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = params.tab ?? ''

  const body =
    tab === 'security' ? <SecurityTab /> : tab === 'keys' ? <ApiKeysView /> : <AccountTab />

  return (
    <>
      <PageHeader title="Profile" subtitle="Your account, security, and personal API keys." />
      <XStack gap="$1" flexWrap="wrap">
        {TABS.map((t) => (
          <Button
            key={t.id || 'account'}
            size="$2"
            bg={t.id === tab ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => router.push(t.id ? `/profile/${t.id}` : '/profile')}
          >
            {t.label}
          </Button>
        ))}
      </XStack>
      {body}
    </>
  )
}
