'use client'

/**
 * Apps (Sites) — the org's BUILDABLE SITES, the projects hanzo.app publishes when a
 * user ships a site from the conversational builder. This closes the console→app
 * round-trip: every site the user builds in hanzo.app shows up here, and each row
 * deep-links straight back into hanzo.app for more conversational editing.
 *
 * Read-only over the REAL cloud `/v1/projects` store (cloud `clients/projectsvc`):
 * every read is same-origin and keyless (`AppsApi` → `originV1Url('projects')` →
 * `<origin>/v1/projects`); `next.config.mjs` rewrites the `projects` head to the
 * console's OWN user-bearer `/cloud` proxy, which mints a short-lived user token and
 * forwards it, so the backend resolves the org from the token owner claim — every row
 * is org-scoped SERVER-SIDE (switching org in the OrgSwitcher re-lists that org's
 * sites) and no credential reaches the browser. The EXACT per-tenant path Agents/CRM
 * use. Distinct from IAM "Projects" (org resource scope) and PaaS "Applications"
 * (container apps) — this is the hanzo.app buildable-sites store only.
 *
 * One list + an optional per-site detail rail (real deployment history). Per row TWO
 * actions: "Open site" (the live URL) and "Edit in hanzo.app" (`/dev?project=<slug>`,
 * the deep-link the builder honors). Every state is honest: loading, a true empty
 * state ("build one in hanzo.app"), and the shared BackendStateCard on 401/403/404/
 * 503 — never a fabricated row.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { AppWindow, ExternalLink, Pencil, RefreshCw, X } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { AppsApi, builderEditUrl, type App, type AppDeployment } from '~/lib/api/apps'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { EmptyState } from '~/components/ui/EmptyState'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

const fmtTime = (s?: number) => (s ? new Date(s * 1000).toLocaleString() : '-')
const dash = (s: string) => (s.trim() ? s : '-')

const fmtBytes = (n: number): string => {
  if (!n) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i && v < 10 ? 1 : 0)} ${units[i]}`
}

/** Open an external URL in a new tab (no-opener), guarded for SSR. */
const openHref = (href: string) => {
  if (href && typeof window !== 'undefined') window.open(href, '_blank', 'noopener,noreferrer')
}

/** The hanzo.app builder deep-link for a site, using the configured app base. */
const editUrl = (slug: string) => builderEditUrl(slug, config.appUrl)

// ── Per-row actions: Open site + Edit in hanzo.app ────────────────────────────

function RowActions({ app }: { app: App }) {
  return (
    <XStack gap="$2" items="center">
      {app.liveUrl ? (
        <Button
          size="$2"
          chromeless
          aria-label={`Open ${dash(app.name || app.slug)}`}
          icon={<ExternalLink size={14} />}
          onPress={() => openHref(app.liveUrl)}
        >
          <Text fontSize="$2" color="$color11">Open site</Text>
        </Button>
      ) : (
        <Text fontSize="$2" color="$color10">—</Text>
      )}
      <Button
        size="$2"
        aria-label={`Edit ${dash(app.name || app.slug)} in hanzo.app`}
        icon={<Pencil size={14} />}
        onPress={() => openHref(editUrl(app.slug))}
      >
        <Text fontSize="$2">Edit in hanzo.app</Text>
      </Button>
    </XStack>
  )
}

// ── Detail rail: real deployment history + the two actions ────────────────────

type DetailState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; app: App; deployments: AppDeployment[] }

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <XStack justify="space-between" gap="$3" items="flex-start">
      <Text fontSize="$2" color="$color10">{label}</Text>
      <Text fontSize="$2" color="$color12" numberOfLines={1} text="right" maxW={220}>{value}</Text>
    </XStack>
  )
}

/**
 * Self-contained by slug: loads the site (`GET /v1/projects/:slug`) and its
 * deploy history (`.../deployments`) so the rail renders identically whether opened
 * from a row press or a `/apps/:slug` deep link. A deployments failure degrades that
 * section (the site facts still render); a site-load failure shows the honest error.
 */
function AppDetail({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [state, setState] = useState<DetailState>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    Promise.all([
      AppsApi.get(slug),
      AppsApi.deployments(slug).catch(() => [] as AppDeployment[]),
    ])
      .then(([app, deployments]) => setState({ phase: 'ready', app, deployments }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [slug])
  useEffect(() => { load() }, [load])

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" justify="space-between">
        <Text fontSize="$5" fontWeight="800" numberOfLines={1}>
          {state.phase === 'ready' ? dash(state.app.name || state.app.slug) : slug}
        </Text>
        <Button size="$2" chromeless aria-label="Close details" icon={<X size={16} />} onPress={onClose} />
      </XStack>

      {state.phase === 'loading' ? (
        <XStack p="$4" justify="center"><Spinner size="small" color="$color11" /></XStack>
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint={`endpoint · GET /v1/projects/${slug}`} />
      ) : (
        <>
          <XStack gap="$2" items="center">
            <StatusTag status={state.app.status || 'unknown'} />
            {state.app.framework ? <Text fontSize="$2" color="$color10">{state.app.framework}</Text> : null}
          </XStack>

          <XStack gap="$2" flexWrap="wrap">
            {state.app.liveUrl ? (
              <Button size="$2" chromeless icon={<ExternalLink size={14} />} onPress={() => openHref(state.app.liveUrl)}>
                <Text fontSize="$2" color="$color11">Open site</Text>
              </Button>
            ) : null}
            <Button size="$2" icon={<Pencil size={14} />} onPress={() => openHref(editUrl(state.app.slug))}>
              <Text fontSize="$2">Edit in hanzo.app</Text>
            </Button>
          </XStack>

          <YStack gap="$1.5" pt="$1" borderTopWidth={1} borderColor="$borderColor">
            <Fact label="Slug" value={state.app.slug} />
            <Fact label="Live URL" value={state.app.liveUrl || '—'} />
            <Fact label="Repo" value={state.app.repo.url || '—'} />
            <Fact label="Created" value={fmtTime(state.app.createdAt)} />
            <Fact label="Updated" value={fmtTime(state.app.updatedAt)} />
          </YStack>

          <YStack gap="$2" pt="$1" borderTopWidth={1} borderColor="$borderColor">
            <Text fontSize="$2" fontWeight="700" color="$color11">Deployments</Text>
            {state.deployments.length === 0 ? (
              <Text fontSize="$2" color="$color10">No deployments yet.</Text>
            ) : (
              state.deployments.slice(0, 12).map((d) => (
                <XStack key={d.id} items="center" justify="space-between" gap="$2" py="$1">
                  <YStack minW={0} flex={1}>
                    <Text fontSize="$2" fontWeight="600" numberOfLines={1}>
                      v{d.version}{d.commit ? ` · ${d.commit.slice(0, 7)}` : ''}{d.source ? ` · ${d.source}` : ''}
                    </Text>
                    <Text fontSize="$1" color="$color10" numberOfLines={1}>
                      {fmtTime(d.createdAt)} · {d.files || 0} files · {fmtBytes(d.bytes)}
                    </Text>
                  </YStack>
                  <StatusTag status={d.status || 'unknown'} />
                </XStack>
              ))
            )}
          </YStack>
        </>
      )}
    </Card>
  )
}

// ── Module ────────────────────────────────────────────────────────────────────

export function AppsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const active = params.slug || null
  const [state, setState] = useState<Async<App[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    AppsApi.list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const columns: Column<App>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Site',
        render: (a) => (
          <XStack items="center" gap="$2" minW={0}>
            <AppWindow size={15} color="$color10" />
            <YStack minW={0}>
              <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{dash(a.name || a.slug)}</Text>
              <Text fontSize="$1" color="$color10" numberOfLines={1}>{a.slug}</Text>
            </YStack>
          </XStack>
        ),
      },
      { key: 'framework', header: 'Framework', width: 130, render: (a) => <Text fontSize="$3" color="$color11">{dash(a.framework)}</Text> },
      { key: 'status', header: 'Status', width: 120, render: (a) => <StatusTag status={a.status || 'unknown'} /> },
      { key: 'updatedAt', header: 'Updated', width: 180, render: (a) => <Text fontSize="$3" color="$color10">{fmtTime(a.updatedAt || a.createdAt)}</Text> },
      { key: 'actions', header: '', width: 260, render: (a) => <RowActions app={a} /> },
    ],
    [],
  )

  const header = (
    <PageHeader
      title="Apps"
      subtitle="The sites you build in hanzo.app — per organization. Open the live site, or jump back into hanzo.app to keep editing."
      actions={
        <XStack gap="$2">
          <Button size="$3" icon={<RefreshCw size={15} />} aria-label="Refresh" onPress={load} />
          <PrimaryButton size="$3" icon={<AppWindow size={16} />} onPress={() => openHref(`${config.appUrl}/dev`)}>
            Build in hanzo.app
          </PrimaryButton>
        </XStack>
      }
    />
  )

  if (state.phase === 'error') {
    return (
      <>
        {header}
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/projects" />
      </>
    )
  }

  const apps = state.phase === 'ready' ? state.data : []

  if (state.phase === 'ready' && apps.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={AppWindow}
          title="No apps yet"
          description="Build and publish your first site in hanzo.app — describe what you want and ship it. Every site you publish shows up here, per organization."
          bullets={[
            'Build conversationally in hanzo.app — no boilerplate.',
            'Each published site gets a live URL and a versioned deploy history.',
            'Come back here to open the live site or jump straight into editing.',
          ]}
          primary={{ label: 'Build in hanzo.app', href: `${config.appUrl}/dev` }}
        />
      </>
    )
  }

  return (
    <>
      {header}
      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        <YStack flex={2} minW={320} gap="$2">
          <DataTable
            columns={columns}
            rows={apps}
            loading={state.phase === 'loading'}
            rowKey={(a) => a.slug || a.id}
            onRowPress={(a) => router.push(`/apps/${a.slug}`)}
            empty="No apps yet — build one in hanzo.app."
          />
        </YStack>
        {active ? (
          <YStack flex={1} minW={300}>
            <AppDetail slug={active} onClose={() => router.push('/apps')} />
          </YStack>
        ) : null}
      </XStack>
    </>
  )
}
