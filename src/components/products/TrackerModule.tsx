'use client'

/**
 * Tracker — a NATIVE, Linear-grade issue tracker over the REAL cloud `/v1/tracker`
 * surface (cloud clients/tracker — native Go, per-(org,team) SQLite). The durable
 * replacement for the retired Huly/Svelte hanzo.team tracker: ONE unified board across
 * every team AND every mirrored GitHub repo (the App-webhook seam files GitHub issues
 * under the org's GH team, Source:"git", ExtRef "github:owner/repo#123"), a grouped
 * List + Board + Cycles + Roadmap, a command palette + keyboard-first flow, and
 * agent-actionable work (hand an issue to the coding agent → a linked PR opens).
 *
 * URL-DRIVEN router (the registry declares `''`, `:view`, `:view/:sub`):
 *   /tracker                 All Issues (unified, every team)
 *   /tracker/my              My Issues
 *   /tracker/teams           Teams (KEY-prefixed projects) + create + GitHub sync
 *   /tracker/teams/:key      one team's board
 *   /tracker/cycles          the current cycle (derived)
 *   /tracker/roadmap         epics + children
 *
 * On tracker.<brand> this module IS the standalone shell (see lib/products/shell.ts):
 * the catalog chrome is gone and the module's own views are the nav. Keyboard: `c`
 * create, `/` search, `g` then i/m/t/c/r to navigate, j/k/↑/↓ + Enter to move/open,
 * and — in the standalone shell only — ⌘K opens the tracker command palette (a
 * capture-phase listener so it never fights the console's global ⌘K).
 *
 * Honest by construction: every row is the real `/v1/tracker` payload, org-scoped
 * SERVER-SIDE; a failed load surfaces ErrorState, an empty org shows EmptyState —
 * never a fabricated project or issue.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Text, XStack, YStack } from '@hanzo/gui'
import {
  ClipboardList,
  Plus,
  RefreshCw,
  Github,
  Layers,
  Target,
  Users,
  Inbox,
  UserCircle,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { TrackerApi, type Project, type Issue } from '~/lib/api/tracker'
import { restPost, originV1Url } from '~/lib/api/client'
import { ApiError } from '~/lib/api'
import { useSession } from '~/lib/auth/session'
import { SlideOver } from '~/components/ui/SlideOver'
import { ErrorState, asApiError } from '~/components/ui/States'
import { useToast } from '~/components/ui/Toast'
import { myIssues, isTypingTarget } from './tracker/logic'
import { IssuesView, TeamsView, CyclesView, RoadmapView, TeamHeader } from './tracker/views'
import { IssueDetail } from './tracker/IssueDetail'
import { TrackerCommand, type Command } from './tracker/TrackerCommand'
import { FieldRow, FieldSelect, PageHeader } from '@hanzo/ui/product'

type Editing = { mode: 'create' } | { mode: 'edit'; issue: Issue }

// ── Shared data loader (ONE projects fetch, then the unified issue merge) ─────

function useTracker() {
  const [projects, setProjects] = useState<Project[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const ps = await TrackerApi.listProjects()
      const settled = await Promise.allSettled(ps.map((p) => TrackerApi.listIssues(p.key)))
      const merged: Issue[] = []
      for (const r of settled) if (r.status === 'fulfilled') merged.push(...r.value)
      setProjects(ps)
      setIssues(merged)
      setError(null)
    } catch (e) {
      setError(asApiError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { projects, issues, loading, error, reload: load }
}

export function TrackerModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const toast = useToast()
  const { account } = useSession()
  const me = account?.email || account?.name || ''
  const standalone = config.shell === 'tracker'

  const view = params.view ?? ''
  const teamKey = view === 'teams' ? (params.sub ?? '') : ''

  const { projects, issues, loading, error, reload } = useTracker()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [createKey, setCreateKey] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const go = useCallback(
    (v: string) => router.push(v ? `/tracker/${v}` : '/tracker'),
    [router],
  )
  const openTeam = useCallback((key: string) => router.push(`/tracker/teams/${encodeURIComponent(key)}`), [router])
  const openIssue = useCallback((i: Issue) => setEditing({ mode: 'edit', issue: i }), [])

  // Create — needs a team. Default into the current team board, else the first team;
  // with no team at all, send the user to create one first (honest).
  const startCreate = useCallback(() => {
    const target = teamKey || projects[0]?.key || ''
    if (!target) {
      toast.error('No team yet', 'Create a team before adding issues.')
      go('teams')
      return
    }
    setCreateKey(target)
    setEditing({ mode: 'create' })
  }, [teamKey, projects, toast, go])

  // GitHub sync — trigger the org's backfill (the App-webhook lane's endpoint), then
  // reload so the mirrored issues appear. Honest error if it isn't routed/authorized.
  const syncGitHub = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await restPost<{ created?: number; updated?: number; repos?: number }>(
        originV1Url('integrations/github/issues/backfill'),
        {},
      )
      const c = res?.created ?? 0
      const u = res?.updated ?? 0
      toast.success('GitHub synced', `${c} new · ${u} updated across ${res?.repos ?? 0} repos.`)
      await reload()
    } catch (e) {
      const err = asApiError(e)
      toast.error(
        'Could not sync GitHub',
        err.status === 404
          ? 'The GitHub connector is not routed on this deployment yet.'
          : err.status === 403
            ? 'Connect the GitHub App for this org first.'
            : err.message,
      )
    } finally {
      setSyncing(false)
    }
  }, [toast, reload])

  // ── g-chord navigation (Linear): g then i/m/t/c/r ─────────────────────────
  useEffect(() => {
    let armed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const map: Record<string, string> = { i: '', m: 'my', t: 'teams', c: 'cycles', r: 'roadmap' }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (armed) {
        armed = false
        if (timer) clearTimeout(timer)
        if (e.key in map) {
          e.preventDefault()
          go(map[e.key])
        }
        return
      }
      if (e.key === 'g') {
        armed = true
        timer = setTimeout(() => {
          armed = false
        }, 800)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer) clearTimeout(timer)
    }
  }, [go])

  // ── ⌘K palette — STANDALONE shell only, capture-phase so the console's global
  //    ⌘K never also fires (each shell has exactly one ⌘K owner). ───────────────
  useEffect(() => {
    if (!standalone) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setPaletteOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [standalone])

  // ── Command palette contents ──────────────────────────────────────────────
  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      { id: 'nav-all', label: 'All Issues', hint: 'g i', group: 'Navigate', icon: Inbox, run: () => go('') },
      { id: 'nav-my', label: 'My Issues', hint: 'g m', group: 'Navigate', icon: UserCircle, run: () => go('my') },
      { id: 'nav-teams', label: 'Teams', hint: 'g t', group: 'Navigate', icon: Users, run: () => go('teams') },
      { id: 'nav-cycles', label: 'Current cycle', hint: 'g c', group: 'Navigate', icon: Target, run: () => go('cycles') },
      { id: 'nav-roadmap', label: 'Roadmap', hint: 'g r', group: 'Navigate', icon: Layers, run: () => go('roadmap') },
    ]
    const actions: Command[] = [
      { id: 'act-new', label: 'New issue', hint: 'c', group: 'Actions', icon: Plus, run: startCreate },
      { id: 'act-sync', label: 'Sync GitHub issues', group: 'Actions', icon: Github, run: () => void syncGitHub() },
      { id: 'act-reload', label: 'Refresh', group: 'Actions', icon: RefreshCw, run: () => void reload() },
    ]
    const teams: Command[] = projects.map((p) => ({
      id: `team-${p.key}`,
      label: `Team: ${p.name}`,
      hint: p.key,
      group: 'Teams',
      icon: Users,
      run: () => openTeam(p.key),
    }))
    const jump: Command[] = issues.slice(0, 80).map((i) => ({
      id: `issue-${i.id}`,
      label: i.title || i.identifier,
      hint: i.identifier,
      group: 'Issues',
      icon: ClipboardList,
      run: () => openIssue(i),
    }))
    return [...nav, ...actions, ...teams, ...jump]
  }, [projects, issues, go, startCreate, syncGitHub, reload, openTeam, openIssue])

  // ── Render ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <>
        <PageHeader title="Tracker" subtitle="Issues across every team and GitHub repo." />
        <ErrorState
          err={error}
          onRetry={reload}
          copy={{ notFound: 'The tracker service is not routed on this deployment yet.' }}
        />
      </>
    )
  }

  const detailPane = (
    <SlideOver
      open={!!editing}
      onClose={() => setEditing(null)}
      title={editing?.mode === 'edit' ? editing.issue.identifier : 'New issue'}
      icon={ClipboardList}
      size={560}
    >
      {editing ? (
        <YStack gap="$3">
          {editing.mode === 'create' && projects.length > 1 && !teamKey ? (
            <FieldRow label="Team">
              <FieldSelect
                value={createKey}
                options={projects.map((p) => p.key)}
                onChange={setCreateKey}
              />
            </FieldRow>
          ) : null}
          <IssueDetail
            projectKey={editing.mode === 'edit' ? editing.issue.projectKey : createKey}
            issue={editing.mode === 'edit' ? editing.issue : null}
            allIssues={issues}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              void reload()
            }}
            onDeleted={() => {
              setEditing(null)
              void reload()
            }}
            onOpenIssue={openIssue}
          />
        </YStack>
      ) : null}
    </SlideOver>
  )

  const palette = standalone ? (
    <TrackerCommand open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
  ) : null

  // A specific team's board.
  if (view === 'teams' && teamKey) {
    const project = projects.find((p) => p.key === teamKey)
    const teamIssues = issues.filter((i) => i.projectKey === teamKey)
    return (
      <>
        <IssuesView
          issues={teamIssues}
          projects={projects}
          showTeam={false}
          header={
            project ? (
              <TeamHeader project={project} onBack={() => go('teams')} />
            ) : (
              <PageHeader title={teamKey} subtitle="Team board" />
            )
          }
          onOpen={openIssue}
          onCreate={startCreate}
          onReload={reload}
        />
        {detailPane}
        {palette}
      </>
    )
  }

  if (view === 'teams') {
    return (
      <>
        <TeamsView
          projects={projects}
          issues={issues}
          loading={loading}
          onOpenTeam={openTeam}
          onReload={reload}
          onSyncGitHub={syncGitHub}
          syncing={syncing}
        />
        {detailPane}
        {palette}
      </>
    )
  }

  if (view === 'cycles') {
    return (
      <>
        <CyclesView issues={issues} projects={projects} onOpen={openIssue} />
        {detailPane}
        {palette}
      </>
    )
  }

  if (view === 'roadmap') {
    return (
      <>
        <RoadmapView issues={issues} projects={projects} onOpen={openIssue} />
        {detailPane}
        {palette}
      </>
    )
  }

  // My Issues.
  if (view === 'my') {
    const mine = myIssues(issues, me)
    return (
      <>
        <IssuesView
          issues={mine}
          projects={projects}
          header={
            <PageHeader
              title="My Issues"
              subtitle={me ? `Assigned to ${me}.` : 'Sign in to see issues assigned to you.'}
            />
          }
          onOpen={openIssue}
          onCreate={startCreate}
          onReload={reload}
        />
        {detailPane}
        {palette}
      </>
    )
  }

  // All Issues (unified) — the default.
  return (
    <>
      <IssuesView
        issues={issues}
        projects={projects}
        header={
          <PageHeader
            title="Issues"
            subtitle={
              `${issues.length} issue${issues.length === 1 ? '' : 's'} across ${projects.length} team${projects.length === 1 ? '' : 's'}` +
              (standalone ? ' · ⌘K for commands · press “c” to create' : '')
            }
          />
        }
        onOpen={openIssue}
        onCreate={startCreate}
        onReload={reload}
        actions={
          <>
            <Text
              onPress={() => void syncGitHub()}
              cursor="pointer"
              hoverStyle={{ opacity: 0.8 }}
              aria-label="Sync GitHub"
            >
              <Github size={15} />
            </Text>
          </>
        }
      />
      {detailPane}
      {palette}
    </>
  )
}
