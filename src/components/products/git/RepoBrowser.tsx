'use client'

/**
 * Repo browser — the gitea-parity repository detail. Header (name · description ·
 * facts · clone panel · deploy-status slot), a branch/tag selector, the
 * Code/Commits/Issues/PRs/Actions tab strip, and the tree/blob/commits body. The
 * ref, path, view, and tab are held in the URL query so every location is a
 * shareable deep link; navigation just patches the query. Self-contained by name so
 * it renders identically from a Repos-face row press or a `/code/repos/:name` deep link.
 * The header carries the agentic handoffs (Ask AI · Edit in hanzo.app · Chat).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, CircleDot, GitBranch, GitPullRequest, Play, Rocket } from '@hanzogui/lucide-icons-2'

import { GitApi, type RefList, type Repo } from '~/lib/api/git'
import { fmtBytes } from '~/lib/api/agents'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import {
  ClonePanel,
  ComingSoonTab,
  PathBreadcrumb,
  RefSelector,
  RepoTabs,
  type RepoTab,
} from './parts'
import { breadcrumbSegments, cleanPath } from './logic'
import { CodeView } from './CodeView'
import { CommitsView } from './CommitsView'
import { AgentActions } from '../code/AgentActions'
import { askRepoPrompt, CODE_BASE } from '../code/hub-logic'

/** The Repositories face of the Code hub — where the back link + repo rows live. */
const REPOS_BASE = `${CODE_BASE}/repos`

const EM = '—'

type RepoState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'missing' }
  | { phase: 'ready'; repo: Repo }

const TABS = new Set<RepoTab>(['code', 'commits', 'issues', 'pulls', 'actions'])
const asTab = (v: string | null): RepoTab => (v && TABS.has(v as RepoTab) ? (v as RepoTab) : 'code')

export function RepoBrowser({ name }: { name: string }) {
  const router = useRouter()
  // `useSearchParams()` is typed `ReadonlyURLSearchParams | null` (null only during a
  // non-Suspense prerender); fall back to empty params so the URL-derived coordinates
  // below read their defaults instead of tripping a null access.
  const searchParams = useSearchParams() ?? new URLSearchParams()

  const [state, setState] = useState<RepoState>({ phase: 'loading' })
  const [refs, setRefs] = useState<RefList | null>(null)
  const [refsLoading, setRefsLoading] = useState(true)

  // ── URL-derived coordinates ────────────────────────────────────────────────
  const tab = asTab(searchParams.get('tab'))
  const path = cleanPath(searchParams.get('path') ?? '')
  const view = searchParams.get('view') === 'blob' ? 'blob' : 'tree'
  const repo = state.phase === 'ready' ? state.repo : null
  const activeRef = searchParams.get('ref') || refs?.default || repo?.defaultBranch || 'main'

  const setQuery = useCallback(
    (patch: Record<string, string | undefined>) => {
      const sp = new URLSearchParams(searchParams.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') sp.delete(k)
        else sp.set(k, v)
      }
      const qs = sp.toString()
      router.push(`${REPOS_BASE}/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`)
    },
    [router, searchParams, name],
  )

  const loadRepo = useCallback(() => {
    setState({ phase: 'loading' })
    GitApi.repo(name)
      .then((r) => setState(r ? { phase: 'ready', repo: r } : { phase: 'missing' }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [name])

  useEffect(() => {
    loadRepo()
  }, [loadRepo])

  // Refs are best-effort: on failure fall back to the repo's own branches/default so
  // the selector still works and the browser never blocks on a missing /refs route.
  useEffect(() => {
    let live = true
    setRefsLoading(true)
    GitApi.refs(name)
      .then((r) => {
        if (live) setRefs(r)
      })
      .catch(() => {
        if (live) setRefs(null)
      })
      .finally(() => {
        if (live) setRefsLoading(false)
      })
    return () => {
      live = false
    }
  }, [name])

  // Fallback ref list from the repo detail when /refs isn't available.
  const effectiveRefs: RefList | null = useMemo(() => {
    if (refs) return refs
    if (!repo) return null
    const names = repo.branches.length ? repo.branches : [repo.defaultBranch]
    return { branches: names.map((n) => ({ name: n, sha: '' })), tags: [], default: repo.defaultBranch }
  }, [refs, repo])

  const crumbs = useMemo(() => breadcrumbSegments(path), [path])

  if (state.phase === 'loading') {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  if (state.phase === 'error') {
    return (
      <YStack gap="$4">
        <BackButton onPress={() => router.push(REPOS_BASE)} />
        <BackendStateCard state={state.error} onRetry={loadRepo} hint={`endpoint · GET /v1/git/repos/${name}`} />
      </YStack>
    )
  }
  if (state.phase === 'missing') {
    return (
      <YStack gap="$4">
        <BackButton onPress={() => router.push(REPOS_BASE)} />
        <Card borderWidth={1} borderColor="$borderColor" p="$5">
          <Text fontSize="$3" color="$color10">
            This repository doesn’t exist or you don’t have access to it.
          </Text>
        </Card>
      </YStack>
    )
  }

  const r = state.repo

  return (
    <YStack gap="$4">
      <BackButton onPress={() => router.push(REPOS_BASE)} />

      {/* Header — identity + facts on the left, clone + deploy on the right. */}
      <XStack justify="space-between" items="flex-start" gap="$4" flexWrap="wrap">
        <YStack gap="$2" flex={1} minW={260}>
          <XStack items="center" gap="$2" minW={0}>
            <GitBranch size={20} color="$color10" />
            <Text fontSize="$7" fontWeight="600" numberOfLines={1}>
              {r.name}
            </Text>
          </XStack>
          {r.description ? (
            <Text fontSize="$3" color="$color11">
              {r.description}
            </Text>
          ) : null}
          <XStack items="center" gap="$3" flexWrap="wrap" pt="$1">
            <Fact label="Default branch" value={r.defaultBranch || EM} mono />
            <Fact label="Size" value={fmtBytes(r.sizeBytes)} mono />
            {r.project ? <Fact label="Project" value={r.project} /> : null}
          </XStack>
          {/* Agentic handoffs — Ask the built-in assistant about the repo, or open it in
              the hanzo.app builder / hanzo.chat (the shared ?project= key). */}
          <XStack pt="$1">
            <AgentActions repo={r.name} seedPrompt={askRepoPrompt(r)} />
          </XStack>
        </YStack>

        <YStack gap="$3" minW={280} maxW={380} flex={1}>
          <ClonePanel cloneUrl={r.cloneUrl} sshUrl={r.sshUrl} />
          <DeployStatusSlot repoName={r.name} onDeploy={() => router.push('/platform')} />
        </YStack>
      </XStack>

      <RepoTabs active={tab} onSelect={(t) => setQuery({ tab: t === 'code' ? undefined : t })} />

      {tab === 'code' ? (
        <YStack gap="$3">
          <XStack items="center" gap="$3" flexWrap="wrap">
            <RefSelector
              refs={effectiveRefs}
              active={activeRef}
              loading={refsLoading && !effectiveRefs}
              onSelect={(ref) => setQuery({ ref })}
            />
            <PathBreadcrumb
              repoName={r.name}
              crumbs={crumbs}
              onNavigate={(p) => setQuery({ path: p || undefined, view: undefined })}
            />
          </XStack>
          <CodeView
            name={r.name}
            refName={activeRef}
            path={path}
            view={view}
            onNavigate={(p, v) => setQuery({ path: p || undefined, view: v === 'tree' ? undefined : v })}
          />
        </YStack>
      ) : tab === 'commits' ? (
        <YStack gap="$3">
          <XStack items="center" gap="$3" flexWrap="wrap">
            <RefSelector
              refs={effectiveRefs}
              active={activeRef}
              loading={refsLoading && !effectiveRefs}
              onSelect={(ref) => setQuery({ ref })}
            />
          </XStack>
          <CommitsView name={r.name} refName={activeRef} />
        </YStack>
      ) : tab === 'issues' ? (
        <ComingSoonTab
          icon={<CircleDot size={22} color="$color10" />}
          title="Issues are coming"
          description="Track bugs and work for this repository. Issue tracking lands here once the backend is enabled — for now, use the Tracker product or the CLI."
        />
      ) : tab === 'pulls' ? (
        <ComingSoonTab
          icon={<GitPullRequest size={22} color="$color10" />}
          title="Pull requests are coming"
          description="Review and merge changes right here. Pull requests light up once the backend is enabled — for now, push branches and open PRs from your local git."
        />
      ) : (
        <ComingSoonTab
          icon={<Play size={22} color="$color10" />}
          title="Actions are coming"
          description="Run CI/CD workflows on push. Actions appear here once wired to the Hanzo runner fleet — build and deploy pipelines are managed under Deploy for now."
        />
      )}
    </YStack>
  )
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Button size="$2" chromeless self="flex-start" icon={<ArrowLeft size={15} />} onPress={onPress} aria-label="Back to repositories">
      <Text fontSize="$2" color="$color11">
        All repositories
      </Text>
    </Button>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <XStack items="center" gap="$1.5">
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" className={mono ? 'mono' : undefined} numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

/**
 * Deploy-status slot — a per-repo PaaS deployment surface. There is no per-repo deploy
 * read in the git contract yet, so this shows an HONEST "no deployments" state with a
 * real path to ship the repo to PaaS (the Platform product), never a fabricated status.
 * When a deploy endpoint lands, this slot is where its live status renders.
 */
function DeployStatusSlot({ repoName, onDeploy }: { repoName: string; onDeploy: () => void }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$2">
      <XStack items="center" gap="$2">
        <Rocket size={15} color="$color10" />
        <Text fontSize="$2" fontWeight="700" color="$color11">
          Deployments
        </Text>
      </XStack>
      <Text fontSize="$2" color="$color10">
        No deployments for {repoName} yet. Ship this repository to Hanzo PaaS to run it.
      </Text>
      <Button size="$2" theme="light" self="flex-start" onPress={onDeploy}>
        <Text fontSize="$2" fontWeight="600">
          Deploy to PaaS
        </Text>
      </Button>
    </Card>
  )
}
