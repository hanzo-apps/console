'use client'

/**
 * Social — the ONE native social surface, rendered IN-CONSOLE over cloud
 * `/v1/social/*` (`hanzoai/cloud` clients/social: a native-Go per-org accounts + posts
 * store on Base/SQLite, the in-process fold of the live social stack
 * github.com/hanzoai/social, twin of clients/crm) through the `/v1` user-bearer proxy.
 * NO link-out, one surface.
 *
 * This is the console half of the `/v1/social` domain seam — the host→mode twin of
 * Billing: on social.hanzo.ai (config.socialOnly) the console boots straight into THIS
 * product. Parity with the live social-frontend: compose + schedule, a list AND a
 * calendar (agenda) view, a real Publish action (POST /v1/social/posts/:id/publish),
 * and a connect flow that reflects each network's LIVE publish-readiness
 * (GET /v1/social/providers) — honest about which OAuth-app credentials a deployment
 * still needs, never a fabricated "connected".
 *
 * Every read/write is org-scoped by the Bearer owner claim SERVER-SIDE. States are
 * honest: loading, a BackendStateCard on a `/v1` failure, and real empty states.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'
import { Share2, Send, Link2, Plus, RefreshCw, Calendar, List, CheckCircle2, AlertTriangle } from '@hanzogui/lucide-icons-2'

import {
  PROVIDERS,
  SocialApi,
  type Account,
  type Post,
  type ProviderCapability,
  type Summary,
} from '~/lib/api/social'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { FieldRow, FieldText, FieldTextArea, FieldSelect } from '@hanzo/ui/product'
import { PageHeader } from '@hanzo/ui/product'
import { PrimaryButton } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { SlideOver } from '@hanzo/ui/product'

/** Compose intents → the (status, scheduleAt) the backend stores. */
const COMPOSE_MODES = ['draft', 'schedule', 'now'] as const
type ComposeMode = (typeof COMPOSE_MODES)[number]
const COMPOSE_LABEL: Record<ComposeMode, string> = { draft: 'Save draft', schedule: 'Schedule', now: 'Publish now' }

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

/** Unix seconds → a day bucket key + label for the agenda (calendar) view. */
function dayOf(unix: number): { key: string; label: string } {
  const d = new Date(unix * 1000)
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return { key, label }
}

/** Truncate a post body for a table cell / agenda card. */
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

type Data = { summary: Summary; posts: Post[]; accounts: Account[]; providers: ProviderCapability[] }
type View = 'list' | 'calendar'

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

/** List / Calendar view toggle (a small inline segmented control). */
function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const opts: { id: View; label: string; icon: typeof List }[] = [
    { id: 'list', label: 'List', icon: List },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
  ]
  return (
    <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
      {opts.map((o) => {
        const Icon = o.icon
        const active = view === o.id
        return (
          <XStack
            key={o.id}
            items="center"
            gap="$2"
            px="$3"
            py="$2"
            cursor="pointer"
            bg={active ? '$color4' : 'transparent'}
            hoverStyle={{ bg: active ? '$color4' : '$color2' }}
            onPress={() => onChange(o.id)}
          >
            <Icon size={14} />
            <Text fontSize="$2" fontWeight={active ? '500' : '400'}>
              {o.label}
            </Text>
          </XStack>
        )
      })}
    </XStack>
  )
}

/** Calendar (agenda) view: scheduled/published posts with a time, grouped by day. */
function PostAgenda({ posts, onOpen }: { posts: Post[]; onOpen: (p: Post) => void }) {
  const days = useMemo(() => {
    const timed = posts.filter((p) => p.scheduleAt > 0).sort((a, b) => a.scheduleAt - b.scheduleAt)
    const groups: { label: string; items: Post[] }[] = []
    const index = new Map<string, number>()
    for (const p of timed) {
      const { key, label } = dayOf(p.scheduleAt)
      let i = index.get(key)
      if (i === undefined) {
        i = groups.length
        index.set(key, i)
        groups.push({ label, items: [] })
      }
      groups[i].items.push(p)
    }
    return groups
  }, [posts])

  if (days.length === 0) {
    return (
      <EmptyState
        icon={Calendar}
        title="Nothing on the calendar"
        description="Scheduled and timed posts appear here, grouped by day. Compose a post and pick Schedule to plan ahead."
      />
    )
  }

  return (
    <YStack gap="$4">
      {days.map((d) => (
        <YStack key={d.label} gap="$2">
          <Text fontSize="$3" fontWeight="500" color="$color11">
            {d.label}
          </Text>
          {d.items.map((p) => (
            <XStack
              key={p.id}
              items="center"
              justify="space-between"
              gap="$3"
              borderWidth={1}
              borderColor="$borderColor"
              rounded="$4"
              px="$4"
              py="$3"
              cursor="pointer"
              hoverStyle={{ bg: '$color2' }}
              onPress={() => onOpen(p)}
            >
              <YStack gap="$1" flex={1}>
                <Text fontSize="$3">{preview(p.content)}</Text>
                <XStack gap="$2" items="center">
                  <Text fontSize="$1" color="$color10">
                    {p.channel}
                  </Text>
                  <Text fontSize="$1" color="$color10">
                    · {when(p.scheduleAt)}
                  </Text>
                </XStack>
              </YStack>
              <StatusTag status={p.status} />
            </XStack>
          ))}
        </YStack>
      ))}
    </YStack>
  )
}

/** The post detail drawer — full content + publish results + a real Publish action. */
function PostDetail({ post, onChanged }: { post: Post; onChanged: () => void }) {
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canPublish = post.status === 'draft' || post.status === 'scheduled' || post.status === 'failed'

  const publish = async () => {
    setPublishing(true)
    setError(null)
    try {
      await SocialApi.posts.publish(post.id)
      onChanged()
    } catch (e) {
      // 503 (not configured) carries the exact missing credentials — show it verbatim.
      setError(classifyBackend(e).message || 'Publish failed.')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <YStack gap="$3" p="$4">
      <FieldRow label="Content">
        <Text fontSize="$3">{post.content || '—'}</Text>
      </FieldRow>
      <FieldRow label="Channel">
        <Text fontSize="$3">{post.channel}</Text>
      </FieldRow>
      <FieldRow label="Status">
        <StatusTag status={post.status} />
      </FieldRow>
      {post.scheduleAt > 0 ? (
        <FieldRow label="Scheduled">
          <Text fontSize="$3">{when(post.scheduleAt)}</Text>
        </FieldRow>
      ) : null}
      {post.externalId ? (
        <FieldRow label="External id">
          <Text fontSize="$3" className="hz-tnum">
            {post.externalId}
          </Text>
        </FieldRow>
      ) : null}
      {post.error ? (
        <FieldRow label="Last error">
          <Text fontSize="$2" color="$red10">
            {post.error}
          </Text>
        </FieldRow>
      ) : null}
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error}
        </Text>
      ) : null}
      {canPublish ? (
        <PrimaryButton onPress={publish} disabled={publishing} icon={<Send size={16} />}>
          {publishing ? 'Publishing…' : 'Publish now'}
        </PrimaryButton>
      ) : null}
    </YStack>
  )
}

/** The compose panel — real POST /v1/social/posts, with draft/schedule/publish-now. */
function CreatePostPanel({
  providers,
  onCreated,
}: {
  providers: ProviderCapability[]
  onCreated: () => void
}) {
  const [content, setContent] = useState('')
  const [channel, setChannel] = useState<string>('x')
  const [mode, setMode] = useState<ComposeMode>('draft')
  const [scheduleAt, setScheduleAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cap = providers.find((p) => p.provider === channel)
  const unconfigured = (mode === 'now' || mode === 'schedule') && cap && !cap.credentialsConfigured

  const submit = async () => {
    if (!content.trim()) {
      setError('Content is required.')
      return
    }
    let status = 'draft'
    let at = 0
    if (mode === 'schedule') {
      at = toUnix(scheduleAt)
      if (at <= Math.floor(Date.now() / 1000)) {
        setError('Pick a future date and time to schedule.')
        return
      }
      status = 'scheduled'
    } else if (mode === 'now') {
      status = 'scheduled' // scheduled + scheduleAt 0 ⇒ the backend publishes on create
    }
    setSaving(true)
    setError(null)
    try {
      const created = await SocialApi.posts.create({ content: content.trim(), channel, status, scheduleAt: at })
      // Honest publish-now feedback: if the fan-out failed (e.g. not configured), keep the
      // panel open and show why — the post exists and is marked failed.
      if (mode === 'now' && created.status === 'failed') {
        setError(created.error || 'Publish failed.')
        setSaving(false)
        return
      }
      onCreated()
    } catch (e) {
      setError(classifyBackend(e).message || 'Failed to create post.')
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
      <FieldRow label="When">
        <FieldSelect
          value={mode}
          options={[...COMPOSE_MODES]}
          onChange={(v) => setMode(v as ComposeMode)}
          disabled={saving}
        />
      </FieldRow>
      {mode === 'schedule' ? (
        <FieldRow label="Schedule at">
          <FieldText value={scheduleAt} onChange={setScheduleAt} placeholder="2026-07-15 09:00" disabled={saving} />
        </FieldRow>
      ) : null}
      {unconfigured ? (
        <XStack items="flex-start" gap="$2">
          <AlertTriangle size={14} color="var(--yellow10)" />
          <Text fontSize="$1" color="$color10">
            {channel} isn’t configured to publish yet — needs {cap?.missingCredentials.join(', ')}. The post is saved and
            marked failed on publish until credentials are supplied.
          </Text>
        </XStack>
      ) : null}
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error}
        </Text>
      ) : null}
      <PrimaryButton onPress={submit} disabled={saving}>
        {saving ? 'Working…' : COMPOSE_LABEL[mode]}
      </PrimaryButton>
    </YStack>
  )
}

/** The connect panel — LIVE per-network readiness + a real account add. */
function ConnectAccountPanel({
  providers,
  onCreated,
}: {
  providers: ProviderCapability[]
  onCreated: () => void
}) {
  const [provider, setProvider] = useState<string>('x')
  const [handle, setHandle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      await SocialApi.accounts.create({ provider, handle: handle.trim(), status: 'connected' })
      onCreated()
    } catch (e) {
      setError(classifyBackend(e).message || 'Failed to connect account.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <YStack gap="$4" p="$4">
      <YStack gap="$2">
        <Text fontSize="$2" color="$color10">
          Network publish-readiness
        </Text>
        {providers.map((p) => (
          <XStack key={p.provider} items="center" justify="space-between" gap="$3" py="$1">
            <XStack items="center" gap="$2">
              {p.credentialsConfigured ? (
                <CheckCircle2 size={14} color="var(--green10)" />
              ) : (
                <AlertTriangle size={14} color="var(--yellow10)" />
              )}
              <Text fontSize="$2">{p.provider}</Text>
            </XStack>
            <Text fontSize="$1" color="$color10">
              {p.credentialsConfigured ? 'Ready' : `needs ${p.missingCredentials.join(', ')}`}
            </Text>
          </XStack>
        ))}
      </YStack>

      <YStack gap="$3">
        <FieldRow label="Network">
          <FieldSelect value={provider} options={[...PROVIDERS]} onChange={setProvider} disabled={saving} />
        </FieldRow>
        <FieldRow label="Handle">
          <FieldText value={handle} onChange={setHandle} placeholder="@hanzo" disabled={saving} />
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
    </YStack>
  )
}

export function SocialModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<Async<Data>>({ phase: 'loading' })
  const [view, setView] = useState<View>('list')
  const [creatingPost, setCreatingPost] = useState(false)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [openPost, setOpenPost] = useState<Post | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const [summary, posts, accounts, providers] = await Promise.all([
        SocialApi.summary(),
        SocialApi.posts.list(),
        SocialApi.accounts.list(),
        SocialApi.providers(),
      ])
      setState({ phase: 'ready', data: { summary, posts, accounts, providers } })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const providers = state.phase === 'ready' ? state.data.providers : []
  const posts = state.phase === 'ready' ? state.data.posts : []
  const onCreatedPost = () => {
    setCreatingPost(false)
    void load()
  }
  const onCreatedAccount = () => {
    setCreatingAccount(false)
    void load()
  }
  const onPostChanged = () => {
    setOpenPost(null)
    void load()
  }

  const empty = state.phase === 'ready' && state.data.posts.length === 0 && state.data.accounts.length === 0

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="Publish"
        subtitle="Compose, schedule and publish your content across networks — per org, over the native /v1/social engine."
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
            description="Connect a social account, then compose, schedule and publish across X, Instagram, LinkedIn, TikTok and more."
            primary={{ label: 'New post', onPress: () => setCreatingPost(true) }}
          />
        </YStack>
      ) : (
        <YStack gap="$5">
          {state.phase === 'ready' ? <SummaryBar summary={state.data.summary} /> : null}

          <YStack gap="$3">
            <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
              <XStack items="center" gap="$2">
                <Send size={16} />
                <Text fontSize="$5" fontWeight="500">
                  Posts
                </Text>
              </XStack>
              <ViewToggle view={view} onChange={setView} />
            </XStack>

            {view === 'list' ? (
              <DataTable<Post>
                columns={POST_COLUMNS}
                rows={posts}
                loading={state.phase === 'loading'}
                empty="No posts yet."
                rowKey={(p) => p.id}
                onRowPress={(p) => setOpenPost(p)}
              />
            ) : (
              <PostAgenda posts={posts} onOpen={(p) => setOpenPost(p)} />
            )}
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
        <CreatePostPanel providers={providers} onCreated={onCreatedPost} />
      </SlideOver>
      <SlideOver
        open={creatingAccount}
        onClose={() => setCreatingAccount(false)}
        title="Connect account"
        icon={Link2}
        ariaLabel="Connect account"
      >
        <ConnectAccountPanel providers={providers} onCreated={onCreatedAccount} />
      </SlideOver>
      <SlideOver
        open={openPost !== null}
        onClose={() => setOpenPost(null)}
        title="Post"
        icon={Send}
        ariaLabel="Post detail"
      >
        {openPost ? <PostDetail post={openPost} onChanged={onPostChanged} /> : null}
      </SlideOver>
    </YStack>
  )
}
