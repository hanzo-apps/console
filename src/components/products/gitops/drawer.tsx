'use client'

/**
 * Drawer tab bodies for the CD fleet map — the per-application drill-in fed into
 * `@hanzo/canvas`'s `ServiceDetailDrawer`. Every tab reuses the ONE `/v1/deploy`
 * client + real enrichment (git repo, CI builds); nothing is fabricated. Each tab
 * is its own component, so it fetches only when its tab is the active panel
 * (`ServiceDetailDrawer` renders just the active content). Honest states
 * throughout: loading, an empty note, a message on failure — never invented rows.
 *
 *   Resources — the owned-resource TOPOLOGY (Service CR → Deployment → RS → Pods),
 *               folded by `treeToGraph` and rendered on the shared canvas; a node
 *               opens its live manifest + desired-vs-live verdict + events.
 *   Deploys   — the app's CI build history (`/v1/builds`) as a deploy timeline.
 *   Logs      — the newest pod's logs (`/v1/deploy/:name/logs`).
 *   Source    — the git repo + branch + HEAD commit and the declared image ref.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { GitBranch, GitCommitHorizontal, RefreshCw } from '@hanzogui/lucide-icons-2'
import { DeployTimeline, type DeployEvent, type DrawerTab } from '@hanzo/canvas'

import { GitopsApi, type Application, type AppTree, type LogLine, type ResourceDetail } from '~/lib/api/gitops'
import { GitApi, type Commit, type Repo } from '~/lib/api/git'
import { BuildsApi } from '~/lib/api/builds'
import { asApiError } from '~/components/ui/States'
import { Loader } from '~/components/ui/Loader'
import { LazyProjectCanvas, CanvasFrame } from './canvas-lazy'
import { renderServiceIcon } from '../platform-apps/icons'
import { repoBaseName, treeToGraph } from './logic'
import { toneColor } from '~/components/ui/tone'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** Build the four fleet-app drawer tabs for `app`. */
export function buildFleetTabs(
  app: Application,
  opts: { theme: 'light' | 'dark'; reducedMotion?: boolean },
): DrawerTab[] {
  const repo = repoBaseName(app.image.repository)
  return [
    { id: 'resources', label: 'Resources', content: <ResourcesTab name={app.name} theme={opts.theme} reducedMotion={opts.reducedMotion} /> },
    { id: 'deploys', label: 'Deploys', content: <DeploysTab repo={repo} /> },
    { id: 'logs', label: 'Logs', content: <LogsTab name={app.name} /> },
    { id: 'source', label: 'Source', content: <SourceTab app={app} repo={repo} /> },
  ]
}

// ── Resources: the owned-resource topology + per-node drill-in ────────────────

function ResourcesTab({ name, theme, reducedMotion }: { name: string; theme: 'light' | 'dark'; reducedMotion?: boolean }) {
  const [tree, setTree] = useState<AppTree | null | undefined>(undefined)
  const [err, setErr] = useState<string>('')
  const [selectedRef, setSelectedRef] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setTree(undefined)
    setErr('')
    setSelectedRef(null)
    GitopsApi.tree(name)
      .then((t) => live && setTree(t))
      .catch((e) => {
        if (live) {
          setTree(null)
          setErr(asApiError(e).message)
        }
      })
    return () => {
      live = false
    }
  }, [name])

  const graph = useMemo(() => (tree ? treeToGraph(tree) : { nodes: [], edges: [] }), [tree])

  return (
    <YStack gap="$3">
      {tree === undefined ? (
        <Loader label="Loading topology…" />
      ) : tree === null ? (
        <Text fontSize="$2" color="$color10">
          {err
            ? `Could not load the resource tree: ${err}`
            : 'The owned-resource tree is not available for this application yet.'}
        </Text>
      ) : graph.nodes.length === 0 ? (
        <Text fontSize="$2" color="$color10">No owned resources reported.</Text>
      ) : (
        <>
          <CanvasFrame height={340}>
            <LazyProjectCanvas
              nodes={graph.nodes}
              edges={graph.edges}
              theme={theme}
              reducedMotion={reducedMotion}
              renderIcon={renderServiceIcon}
              showMiniMap={false}
              onOpenDetail={(n) => setSelectedRef(n.id)}
            />
          </CanvasFrame>
          <Text fontSize="$1" color="$color9">
            {graph.nodes.length} resources · tap a node for its manifest, diff, and events.
          </Text>
          {selectedRef ? <ResourceDetailCard name={name} refToken={selectedRef} /> : null}
        </>
      )}
    </YStack>
  )
}

function ResourceDetailCard({ name, refToken }: { name: string; refToken: string }) {
  const [detail, setDetail] = useState<ResourceDetail | null | undefined>(undefined)
  const [err, setErr] = useState<string>('')

  useEffect(() => {
    let live = true
    setDetail(undefined)
    setErr('')
    GitopsApi.resource(name, refToken)
      .then((d) => live && setDetail(d))
      .catch((e) => {
        if (live) {
          setDetail(null)
          setErr(asApiError(e).message)
        }
      })
    return () => {
      live = false
    }
  }, [name, refToken])

  return (
    <Card borderWidth={1} borderColor="$borderColor" rounded="$4" p="$3" gap="$3" bg="$color1">
      {detail === undefined ? (
        <Loader label="Loading resource…" />
      ) : detail === null ? (
        <Text fontSize="$2" color="$color10">Could not load the resource: {err}</Text>
      ) : (
        <>
          <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
            <Text fontSize="$2" color="$color11" style={{ fontFamily: MONO }} numberOfLines={1}>
              {detail.ref}
            </Text>
            <XStack
              px="$2"
              py="$0.5"
              rounded="$2"
              bg={detail.modified ? '$yellow3' : '$green3'}
              items="center"
            >
              <Text fontSize="$1" color={detail.modified ? '$yellow11' : '$green11'} fontWeight="700">
                {detail.desiredSource === 'none' ? 'No desired state' : detail.modified ? 'Out of sync' : 'In sync'}
              </Text>
            </XStack>
          </XStack>

          <ManifestBlock label="Live manifest" body={detail.live} empty="No live manifest." />
          {detail.modified && detail.desired ? (
            <ManifestBlock label={`Desired (${detail.desiredSource || 'last-applied'})`} body={detail.desired} empty="" />
          ) : null}
          <Text fontSize="$1" color="$color9">
            {detail.events.length > 0
              ? `${detail.events.length} events`
              : 'No events reported by the deploy plane for this resource.'}
          </Text>
        </>
      )}
    </Card>
  )
}

function ManifestBlock({ label, body, empty }: { label: string; body: string; empty: string }) {
  if (!body) return empty ? <Text fontSize="$2" color="$color10">{empty}</Text> : null
  return (
    <YStack gap="$1">
      <Text fontSize="$1" color="$color10" fontWeight="600">{label}</Text>
      <ScrollView style={{ maxHeight: 220 }}>
        <YStack bg="$color2" rounded="$3" p="$2">
          <Text fontSize="$1" color="$color11" style={{ fontFamily: MONO, whiteSpace: 'pre' }}>
            {body}
          </Text>
        </YStack>
      </ScrollView>
    </YStack>
  )
}

// ── Deploys: the CI build history as a deploy timeline ────────────────────────

function DeploysTab({ repo }: { repo: string }) {
  const [events, setEvents] = useState<DeployEvent[] | null | undefined>(undefined)
  const [err, setErr] = useState<string>('')

  useEffect(() => {
    let live = true
    setEvents(undefined)
    setErr('')
    BuildsApi.list()
      .then((builds) => {
        const mine = builds.filter((b) => repoBaseName(b.repo) === repo)
        const rows: DeployEvent[] = mine
          .map((b) => {
            const t = Date.parse(b.startedAt)
            return {
              id: b.id || `${b.commit}:${b.startedAt}`,
              status: b.status || 'unknown',
              ref: b.tag || (b.commit ? b.commit.slice(0, 7) : ''),
              source: b.repo,
              message: [b.status, b.duration].filter(Boolean).join(' · '),
              createdAt: Number.isNaN(t) ? undefined : t,
            }
          })
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        if (live) setEvents(rows)
      })
      .catch((e) => {
        if (live) {
          setEvents(null)
          setErr(asApiError(e).message)
        }
      })
    return () => {
      live = false
    }
  }, [repo])

  if (events === undefined) return <Loader label="Loading builds…" />
  if (events === null)
    return (
      <Text fontSize="$2" color="$color10">
        Build history is not available on this deployment ({err}). It appears here once `/v1/builds` is routed.
      </Text>
    )
  return <DeployTimeline events={events} emptyLabel={`No recent builds for ${repo || 'this application'}.`} />
}

// ── Logs: the newest pod's current logs ───────────────────────────────────────

function LogsTab({ name }: { name: string }) {
  const [lines, setLines] = useState<LogLine[] | null>(null)
  const [err, setErr] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setErr('')
    GitopsApi.logs(name, { tail: 300 })
      .then(setLines)
      .catch((e) => setErr(asApiError(e).message))
      .finally(() => setLoading(false))
  }, [name])
  useEffect(() => load(), [load])

  return (
    <YStack gap="$2">
      <XStack justify="flex-end">
        <Button size="$1" chromeless icon={<RefreshCw size={13} />} onPress={load} disabled={loading}>
          Refresh
        </Button>
      </XStack>
      {loading && !lines ? (
        <Loader label="Loading logs…" />
      ) : err ? (
        <Text fontSize="$2" color="$color10">Could not load logs: {err}</Text>
      ) : lines && lines.length ? (
        <ScrollView style={{ maxHeight: 420 }}>
          <YStack gap="$0.5" p="$2" bg="$color1" rounded="$3">
            {lines.map((l, i) => (
              <Text key={i} fontSize="$2" color="$color11" style={{ fontFamily: MONO }}>
                {l.pod ? `[${l.pod}] ` : ''}
                {l.message}
              </Text>
            ))}
          </YStack>
        </ScrollView>
      ) : (
        <Text fontSize="$2" color="$color10">
          No running pod logs yet (the pod may not be scheduled, or the cluster is unreachable).
        </Text>
      )}
    </YStack>
  )
}

// ── Source: git repo + branch + HEAD commit + the declared image ref ──────────

function SourceTab({ app, repo }: { app: Application; repo: string }) {
  const [state, setState] = useState<{ repo: Repo | null; commit: Commit | null } | undefined>(undefined)

  useEffect(() => {
    let live = true
    setState(undefined)
    Promise.allSettled([GitApi.repo(repo), GitApi.commits(repo, { limit: 1 })])
      .then(([r, c]) => {
        if (!live) return
        const repoVal = r.status === 'fulfilled' ? r.value : null
        const commitVal = c.status === 'fulfilled' && c.value.length ? c.value[0] : null
        setState({ repo: repoVal, commit: commitVal })
      })
    return () => {
      live = false
    }
  }, [repo])

  const imageRef = app.image.tag ? `${app.image.repository}:${app.image.tag}` : app.image.repository

  return (
    <YStack gap="$3">
      <Fact label="Image" value={imageRef || '—'} mono />
      {state === undefined ? (
        <Loader label="Loading source…" />
      ) : (
        <>
          <Fact
            label="Repository"
            value={
              <XStack items="center" gap="$1.5">
                <GitBranch size={13} color={toneColor('muted')} />
                <Text fontSize="$2" color="$color12" style={{ fontFamily: MONO }} numberOfLines={1}>
                  {state.repo ? `${state.repo.org}/${state.repo.name}` : repo || '—'}
                </Text>
              </XStack>
            }
          />
          <Fact label="Branch" value={state.repo?.defaultBranch || '—'} mono />
          {state.commit ? (
            <YStack gap="$1" py="$1.5">
              <XStack items="center" gap="$1.5">
                <GitCommitHorizontal size={13} color={toneColor('muted')} />
                <Text fontSize="$2" color="$color12" style={{ fontFamily: MONO }}>
                  {state.commit.shortSha}
                </Text>
              </XStack>
              <Text fontSize="$2" color="$color11" numberOfLines={2}>
                {state.commit.message}
              </Text>
            </YStack>
          ) : (
            <Fact label="HEAD" value={state.repo?.head ? state.repo.head.slice(0, 8) : '—'} mono />
          )}
          {!state.repo ? (
            <Text fontSize="$1" color="$color9">
              This application's repository is not on the git host (or not readable). The declared image ref above is the source of record.
            </Text>
          ) : null}
        </>
      )}
    </YStack>
  )
}

function Fact({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <XStack justify="space-between" items="center" py="$1.5" borderBottomWidth={1} borderColor="$borderColor" gap="$3">
      <Text fontSize="$2" color="$color11">{label}</Text>
      {typeof value === 'string' ? (
        <Text fontSize="$2" color="$color12" fontWeight="600" numberOfLines={1} style={mono ? { fontFamily: MONO } : undefined}>
          {value}
        </Text>
      ) : (
        value
      )}
    </XStack>
  )
}
