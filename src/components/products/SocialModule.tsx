'use client'

/**
 * Social — the ONE native social surface, rendered IN-CONSOLE over cloud
 * `/v1/social/*` (`hanzoai/cloud` clients/social: a native-Go per-org accounts+posts
 * store on Base/SQLite, the in-process fold of the live social stack
 * github.com/hanzoai/social, twin of clients/crm) through the `/v1` user-bearer proxy.
 * NO link-out, one surface.
 *
 * This is the console half of the new `/v1/social` domain seam — the host→mode twin
 * of Billing: on social.hanzo.ai (config.socialOnly) the console boots straight into
 * THIS product. It starts THIN by design: per-org Post + Account CRUD + a real summary
 * roll-up. The orchestrator's real provider push / OAuth channel connect / media
 * pipeline from the live stack are follow-ups that hang off this seam.
 *
 * Every read/write is org-scoped by the Bearer owner claim SERVER-SIDE, so a caller
 * only ever sees THEIR org's posts + accounts. States are honest: loading, a
 * BackendStateCard on a `/v1` failure, and a real empty state — never fabricated rows.
 */
import { useCallback, useEffect, useState } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'
import { Share2, Send, Link2, Plus, RefreshCw } from '@hanzogui/lucide-icons-2'

import {
  PROVIDERS,
  ACCOUNT_STATUSES,
  POST_STATUSES,
  SocialApi,
  type Account,
  type Post,
  type Summary,
} from '~/lib/api/social'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { FieldRow, FieldText, FieldTextArea, FieldSelect } from '~/components/ui/Field'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { StatusTag } from '~/components/ui/StatusTag'
import { SlideOver } from '~/components/ui/SlideOver'

/** Unix seconds → a short local timestamp, or '—' when unset (0). */
function when(unix: number): string {
  if (!unix) return '—'
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Truncate a post body for the table cell (full text lives in the record). */
function preview(s: string): string {
  const t = s.trim()
  return t.length > 72 ? `${t.slice(0, 72)}…` : t || '—'
}

/** Parse a user-typed datetime (ISO or local) into unix seconds; invalid → 0. */
function toUnix(dt: string): number {
  const ms = Date.parse(dt.trim())
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
}

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

type Data = { summary: Summary; posts: Post[]; accounts: Account[] }

const POST_COLUMNS: Column<Post>[] = [
  { key: 'content', header: 'Post', render: (p) => preview(p.content) },
  { key: 'channel', header: 'Channel', render: (p) => p.channel || '—' },
  { key: 'status', header: 'Status', render: (p) => <StatusTag status={p.status} /> },
  { key: 'scheduleAt', header: 'Scheduled', render: (p) => when(p.scheduleAt) },
]

const ACCOUNT_COLUMNS: Column<Account>[] = [
  { key: 'handle', header: 'Account', render: (a) => a.handle || '—' },
  { key: 'provider', header: 'Network', render: (a) => a.provider || '—' },
  { key: 'status', header: 'Status', render: (a) => <StatusTag status={a.status} /> },
]

/** The per-org summary bar (real `/v1/social/summary` counts). */
function SummaryBar({ summary }: { summary: Summary }) {
  const cells: { label: string; value: string | number }[] = [
    { label: 'Posts', value: summary.posts },
    { label: 'Scheduled', value: summary.scheduled },
    { label: 'Published', value: summary.published },
    { label: 'Accounts', value: summary.accounts },
  ]
  return (
    <XStack gap="$3" flexWrap="wrap">
      {cells.map((c) => (
        <YStack key={c.label} gap="$1" borderWidth={1} borderColor="$borderColor" rounded="$4" px="$4" py="$3" minW={140}>
          <Text fontSize="$1" color="$color10">
            {c.label}
          </Text>
          <Text fontSize="$6" fontWeight="500" className="hz-tnum">
            {c.value}
          </Text>
        </YStack>
      ))}
    </XStack>
  )
}

/** The create-post panel — real POST /v1/social/posts. */
function CreatePostPanel({ onCreated }: { onCreated: () => void }) {
  const [content, setContent] = useState('')
  const [channel, setChannel] = useState<string>('x')
  const [status, setStatus] = useState<string>('draft')
  const [scheduleAt, setScheduleAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!content.trim()) {
      setError('Content is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await SocialApi.posts.create({
        content: content.trim(),
        channel,
        status,
        scheduleAt: status === 'scheduled' ? toUnix(scheduleAt) : 0,
      })
      onCreated()
    } catch (e) {
      setError(classifyBackend(e).message || 'Failed to create post.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <YStack gap="$3" p="$4">
      <FieldRow label="Content">
        <FieldTextArea value={content} onChange={setContent} disabled={saving} />
      </FieldRow>
      <FieldRow label="Channel">
        <FieldSelect value={channel} options={[...PROVIDERS]} onChange={setChannel} disabled={saving} />
      </FieldRow>
      <FieldRow label="Status">
        <FieldSelect value={status} options={[...POST_STATUSES]} onChange={setStatus} disabled={saving} />
      </FieldRow>
      {status === 'scheduled' ? (
        <FieldRow label="Schedule at">
          <FieldText value={scheduleAt} onChange={setScheduleAt} placeholder="2026-07-15 09:00" disabled={saving} />
        </FieldRow>
      ) : null}
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error}
        </Text>
      ) : null}
      <PrimaryButton onPress={submit} disabled={saving}>
        {saving ? 'Creating…' : 'Create post'}
      </PrimaryButton>
    </YStack>
  )
}

/** The connect-account panel — real POST /v1/social/accounts. */
function CreateAccountPanel({ onCreated }: { onCreated: () => void }) {
  const [provider, setProvider] = useState<string>('x')
  const [handle, setHandle] = useState('')
  const [status, setStatus] = useState<string>('connected')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      await SocialApi.accounts.create({ provider, handle: handle.trim(), status })
      onCreated()
    } catch (e) {
      setError(classifyBackend(e).message || 'Failed to connect account.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <YStack gap="$3" p="$4">
      <FieldRow label="Network">
        <FieldSelect value={provider} options={[...PROVIDERS]} onChange={setProvider} disabled={saving} />
      </FieldRow>
      <FieldRow label="Handle">
        <FieldText value={handle} onChange={setHandle} placeholder="@hanzo" disabled={saving} />
      </FieldRow>
      <FieldRow label="Status">
        <FieldSelect value={status} options={[...ACCOUNT_STATUSES]} onChange={setStatus} disabled={saving} />
      </FieldRow>
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error}
        </Text>
      ) : null}
      <PrimaryButton onPress={submit} disabled={saving}>
        {saving ? 'Connecting…' : 'Connect account'}
      </PrimaryButton>
    </YStack>
  )
}

export function SocialModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<Async<Data>>({ phase: 'loading' })
  const [creatingPost, setCreatingPost] = useState(false)
  const [creatingAccount, setCreatingAccount] = useState(false)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const [summary, posts, accounts] = await Promise.all([
        SocialApi.summary(),
        SocialApi.posts.list(),
        SocialApi.accounts.list(),
      ])
      setState({ phase: 'ready', data: { summary, posts, accounts } })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onCreatedPost = () => {
    setCreatingPost(false)
    void load()
  }
  const onCreatedAccount = () => {
    setCreatingAccount(false)
    void load()
  }

  const empty = state.phase === 'ready' && state.data.posts.length === 0 && state.data.accounts.length === 0

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="Social"
        subtitle="Posts and accounts across networks — per org, over the native /v1/social engine."
        actions={
          <>
            <PrimaryButton onPress={() => setCreatingPost(true)} icon={<Plus size={16} />}>
              New post
            </PrimaryButton>
            <PrimaryButton onPress={() => setCreatingAccount(true)} icon={<Link2 size={16} />}>
              Connect account
            </PrimaryButton>
            <PrimaryButton onPress={() => void load()} icon={<RefreshCw size={16} />}>
              Refresh
            </PrimaryButton>
          </>
        }
      />

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={() => void load()} />
      ) : empty ? (
        <YStack gap="$4">
          {state.phase === 'ready' ? <SummaryBar summary={state.data.summary} /> : null}
          <EmptyState
            icon={Share2}
            title="No posts or accounts yet"
            description="Connect a social account, then draft and schedule posts across X, Instagram, LinkedIn, TikTok and more."
            primary={{ label: 'New post', onPress: () => setCreatingPost(true) }}
          />
        </YStack>
      ) : (
        <YStack gap="$5">
          {state.phase === 'ready' ? <SummaryBar summary={state.data.summary} /> : null}

          <YStack gap="$2">
            <XStack items="center" gap="$2">
              <Send size={16} />
              <Text fontSize="$5" fontWeight="500">
                Posts
              </Text>
            </XStack>
            <DataTable<Post>
              columns={POST_COLUMNS}
              rows={state.phase === 'ready' ? state.data.posts : []}
              loading={state.phase === 'loading'}
              empty="No posts yet."
              rowKey={(p) => p.id}
            />
          </YStack>

          <YStack gap="$2">
            <XStack items="center" gap="$2">
              <Link2 size={16} />
              <Text fontSize="$5" fontWeight="500">
                Accounts
              </Text>
            </XStack>
            <DataTable<Account>
              columns={ACCOUNT_COLUMNS}
              rows={state.phase === 'ready' ? state.data.accounts : []}
              loading={state.phase === 'loading'}
              empty="No accounts connected yet."
              rowKey={(a) => a.id}
            />
          </YStack>
        </YStack>
      )}

      <SlideOver open={creatingPost} onClose={() => setCreatingPost(false)} title="New post" icon={Send} ariaLabel="New post">
        <CreatePostPanel onCreated={onCreatedPost} />
      </SlideOver>
      <SlideOver
        open={creatingAccount}
        onClose={() => setCreatingAccount(false)}
        title="Connect account"
        icon={Link2}
        ariaLabel="Connect account"
      >
        <CreateAccountPanel onCreated={onCreatedAccount} />
      </SlideOver>
    </YStack>
  )
}
