'use client'

/**
 * Content — the brand's Content Studio (a Payload headless CMS at cms.<brand>,
 * confirmed live at cms.hanzo.ai/admin) surfaced NATIVELY in the console, three ways:
 *
 *   - Collections (native) — the org's `pages`, read live over Payload's REST API
 *     through the console's OWN `/cms` user-bearer proxy. Payload's multi-tenant plugin
 *     scopes every row to the caller's IAM `owner` claim, so a merchant sees ONLY their
 *     own org's content — org isolation is BACKEND-enforced, honest-empty for a new org.
 *   - Media (native) — the org's `media` as a DAM grid; thumbnails stream through the
 *     same per-tenant proxy (`/cms/api/media/file/<f>`), never a cross-origin URL.
 *   - Studio (embed) — the full block editor, the real Payload admin EMBEDDED (SSO
 *     iframe) in the console shell for the org that OWNS the shared brand Studio
 *     (server-gated by `/embed-status`); a customer org gets an honest provision panel.
 *
 * Binds to the canonical Payload backend (native REST reads + the real admin embed) —
 * the CMS is never reimplemented here, and nothing is fabricated: real rows, honest
 * empty, or the shared BackendStateCard.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Image, Text, XStack, YStack } from '@hanzo/gui'
import { FileText, Image as ImageIcon, LayoutGrid, Newspaper, Globe } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { CmsApi, cmsMediaFileUrl, type CmsMedia, type CmsPage } from '~/lib/api/cms'
import { EmbedApi, type EmbedStatus } from '~/lib/api/embed'
import { fmtAbs } from '~/lib/api/functions'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { Loader } from '~/components/ui/Loader'
import { EmbeddedApp } from './embed/EmbeddedApp'
import { ProvisionPanel, type ProvisionFeature } from './embed/ProvisionPanel'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const TABS = [
  { id: '', label: 'Collections', icon: FileText },
  { id: 'media', label: 'Media', icon: LayoutGrid },
  { id: 'studio', label: 'Studio', icon: Newspaper },
] as const

const MANAGES: ProvisionFeature[] = [
  { icon: FileText, label: 'Pages', body: 'Structured, versioned pages that render your marketing and product site.' },
  { icon: Newspaper, label: 'Posts', body: 'Blog and changelog entries with drafts, scheduling, and a publish workflow.' },
  { icon: ImageIcon, label: 'Media', body: 'A managed media library — uploads, focal points, and responsive variants.' },
  { icon: Globe, label: 'Globals', body: 'Site-wide navigation, footer, and settings shared across every surface.' },
]

const fmtBytes = (n?: number): string => {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}

export function CmsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = useMemo(() => {
    const t = params.tab ?? ''
    return TABS.some((x) => x.id === t) ? t : ''
  }, [params.tab])

  return (
    <YStack gap="$4">
      <PageHeader
        title="Content"
        subtitle="Pages, media, and the full Studio — your headless CMS, per org, with IAM single sign-on."
        actions={
          <XStack gap="$1" flexWrap="wrap">
            {TABS.map((t) => (
              <XStack
                key={t.id || 'collections'}
                onPress={() => router.push(t.id ? `/cms/${t.id}` : '/cms')}
                cursor="pointer"
                items="center"
                gap="$1.5"
                px="$3"
                height={34}
                rounded="$3"
                borderWidth={1}
                borderColor="$borderColor"
                bg={t.id === tab ? '$color5' : 'transparent'}
                hoverStyle={{ bg: '$color3' }}
              >
                <t.icon size={15} />
                <Text fontSize="$3" fontWeight="600" color="$color12">{t.label}</Text>
              </XStack>
            ))}
          </XStack>
        }
      />
      {tab === 'media' ? <MediaTab /> : tab === 'studio' ? <StudioTab /> : <CollectionsTab />}
    </YStack>
  )
}

// ── Collections (native pages) ────────────────────────────────────────────────
function CollectionsTab() {
  const [state, setState] = useState<Async<CmsPage[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CmsApi.pages()
      .then((r) => setState({ phase: 'ready', data: r.rows }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const columns: Column<CmsPage>[] = [
    { key: 'title', header: 'Title', render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12">{r.title}</Text> },
    { key: 'slug', header: 'Slug', render: (r) => <Text fontSize="$3" color="$color11">{r.slug || '—'}</Text> },
    { key: 'status', header: 'Status', width: 120, render: (r) => (r.status ? <StatusTag status={r.status === 'published' ? 'active' : r.status} /> : <Text fontSize="$3" color="$color10">—</Text>) },
    { key: 'updated', header: 'Updated', width: 190, render: (r) => <Text fontSize="$3" color="$color10">{fmtAbs(r.updatedAt)}</Text> },
  ]

  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /cms/api/pages (Payload)" />
  }
  return (
    <DataTable
      columns={columns}
      rows={state.phase === 'ready' ? state.data : []}
      loading={state.phase === 'loading'}
      rowKey={(r) => r.id}
      empty="No pages yet. Pages you create in the Studio for this organization appear here."
    />
  )
}

// ── Media (native DAM grid) ───────────────────────────────────────────────────
function MediaTab() {
  const [state, setState] = useState<Async<CmsMedia[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CmsApi.media()
      .then((r) => setState({ phase: 'ready', data: r.rows }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  if (state.phase === 'loading') return <Loader label="Loading media…" />
  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /cms/api/media (Payload)" />
  }
  const items = state.data
  if (items.length === 0) {
    return (
      <Card p="$5" gap="$2" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$4" fontWeight="800" color="$color12">No media yet</Text>
        <Text fontSize="$2" color="$color10">Assets you upload to the Studio media library for this organization appear here.</Text>
      </Card>
    )
  }
  return (
    <XStack flexWrap="wrap" gap="$3">
      {items.map((m) => (
        <MediaCard key={m.id} media={m} />
      ))}
    </XStack>
  )
}

function MediaCard({ media }: { media: CmsMedia }) {
  const isImage = (media.mimeType ?? '').startsWith('image/')
  const src = media.filename ? cmsMediaFileUrl(media.filename) : ''
  return (
    <Card width={210} p="$0" gap="$0" borderWidth={1} borderColor="$borderColor" overflow="hidden">
      <YStack height={140} bg="$color3" items="center" justify="center" overflow="hidden">
        {isImage && src ? (
          <Image source={{ uri: src }} width={210} height={140} resizeMode="cover" alt={media.alt || media.filename || 'media'} />
        ) : (
          <ImageIcon size={30} color="$color9" />
        )}
      </YStack>
      <YStack p="$3" gap="$1">
        <Text fontSize="$2" fontWeight="700" color="$color12" numberOfLines={1}>{media.filename || '(unnamed)'}</Text>
        <XStack gap="$2" flexWrap="wrap">
          <Text fontSize="$1" color="$color10">{media.mimeType || '—'}</Text>
          {media.width && media.height ? <Text fontSize="$1" color="$color10">{media.width}×{media.height}</Text> : null}
          <Text fontSize="$1" color="$color10">{fmtBytes(media.filesize)}</Text>
        </XStack>
      </YStack>
    </Card>
  )
}

// ── Studio (the real Payload admin, embedded — entitlement-gated) ─────────────
function StudioTab() {
  const [state, setState] = useState<Async<EmbedStatus>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    EmbedApi.status('cms')
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  if (state.phase === 'loading') return <Loader label="Loading Content Studio…" />
  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} onRetry={load} hint="probe · GET /embed-status?app=cms" />
  }
  const status = state.data

  // Not entitled (a customer org): honest provision panel — never an embed of the
  // brand's shared Studio admin. The server already withheld the embed URL.
  if (!status.entitled) {
    return (
      <ProvisionPanel
        title="Content Studio"
        subtitle="The full block editor for your pages, posts, and media — with IAM single sign-on."
        heroTitle="Content Studio for your organization"
        heroBody={
          'The Content Studio is a block-based headless CMS (Payload) for pages, posts, and media. Your ' +
          'Collections and Media above are already live and scoped to your organization; the shared block ' +
          'editor runs as a per-brand Studio today, so a dedicated Studio for your organization isn’t ' +
          'provisioned yet — request one and it will appear here, embedded and signed in with your Hanzo identity.'
        }
        features={MANAGES}
        intakeSlug="cms"
        intakeLabel="Content Studio"
        cta="Request Studio"
        docsHref={config.docsUrl ? `${config.docsUrl}/docs/cms` : undefined}
        sourceLabel="hanzoai/cms · Payload headless CMS"
        note="Binds to the canonical Payload backend — the CMS is not reimplemented in the console."
      />
    )
  }

  if (status.reachable) {
    return (
      <EmbeddedApp
        title="Content Studio"
        subtitle="The full Payload block editor, embedded with IAM single sign-on."
        src={status.embedUrl}
        openLabel="Open Studio"
        sourceLabel="hanzoai/cms"
        note="Your brand’s Content Studio, signed in with your Hanzo identity (IAM SSO)."
      />
    )
  }

  return (
    <BackendStateCard
      state={{ kind: 'unavailable', message: `The Content Studio (${status.origin}) is not reachable right now.` }}
      onRetry={load}
      hint={`host · ${status.origin}`}
    />
  )
}
