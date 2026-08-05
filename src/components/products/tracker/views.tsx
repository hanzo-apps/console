'use client'

/**
 * Tracker views — the Linear-grade surfaces rendered by the module's router:
 *   IssuesView  the unified issues board (All / My / a Team) — toolbar + group/filter/
 *               search + List⇄Board + keyboard selection (j/k/↑/↓/Enter/e, c, /).
 *   TeamsView   the teams (KEY-prefixed projects) list + create, with a GitHub sync.
 *   CyclesView  the current cycle — derived from the active window, honest progress.
 *   RoadmapView epics + their ExtRef children, with completion.
 *
 * Every view reads the SAME unified `issues` array (composed cross-team in the module)
 * and decides layout purely via `logic.ts`. Honest empties; no fabricated rows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ClipboardList, Plus, RefreshCw, Github, Layers, Target, ArrowLeft } from '@hanzogui/lucide-icons-2'

import {
  TrackerApi,
  type Issue,
  type Project,
  type NewProject,
} from '~/lib/api/tracker'
import { useToast } from '~/components/ui/Toast'
import { asApiError } from '~/components/ui/States'
import {
  type GroupBy,
  type IssueFilters,
  filterIssues,
  groupIssues,
  boardColumns,
  deriveCurrentCycle,
  deriveRoadmap,
  assigneesOf,
  labelsOf,
  isTypingTarget,
  teamName,
  relTime,
  STATUS_LABEL,
} from './logic'
import { Toolbar } from './Toolbar'
import { GroupedList, Board } from './IssueList'
import { StatusIcon, PriorityIcon, Identifier, ProgressBar } from './atoms'
import { EmptyState, FieldRow, FieldText, FieldTextArea, PageHeader, PrimaryButton } from '@hanzo/ui/product'

// ── The unified issues view (All / My / a Team) ──────────────────────────────

export function IssuesView({
  issues,
  projects,
  header,
  showTeam = true,
  defaultFilters,
  onOpen,
  onCreate,
  onReload,
  actions,
}: {
  issues: Issue[]
  projects: Project[]
  header: React.ReactNode
  showTeam?: boolean
  defaultFilters?: IssueFilters
  onOpen: (i: Issue) => void
  onCreate: () => void
  onReload: () => void
  actions?: React.ReactNode
}) {
  const [view, setView] = useState<'list' | 'board'>('list')
  const [groupBy, setGroupBy] = useState<GroupBy>('status')
  const [filters, setFilters] = useState<IssueFilters>({})
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(
    () => filterIssues(issues, { ...defaultFilters, ...filters, q: query }),
    [issues, defaultFilters, filters, query],
  )
  const groups = useMemo(
    () => (view === 'board' ? boardColumns(filtered) : groupIssues(filtered, groupBy)),
    [filtered, groupBy, view],
  )
  const flat = useMemo(() => groups.flatMap((g) => g.issues), [groups])
  const assignees = useMemo(() => assigneesOf(issues), [issues])
  const labels = useMemo(() => labelsOf(issues), [issues])

  // Keep the selection valid as the list changes.
  useEffect(() => {
    if (selectedId && !flat.some((i) => i.id === selectedId)) setSelectedId(flat[0]?.id)
  }, [flat, selectedId])

  // Keyboard-first (Linear): c=create, /=search, j/k/↑/↓=move, Enter=open, e=edit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        if (isTypingTarget(e.target)) return
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (isTypingTarget(e.target)) return
      if (e.key === 'c') {
        e.preventDefault()
        onCreate()
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedId((cur) => {
          const idx = flat.findIndex((i) => i.id === cur)
          return flat[Math.min(idx + 1, flat.length - 1)]?.id ?? flat[0]?.id
        })
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedId((cur) => {
          const idx = flat.findIndex((i) => i.id === cur)
          return flat[Math.max(idx - 1, 0)]?.id ?? flat[0]?.id
        })
      } else if (e.key === 'Enter' || e.key === 'e') {
        const sel = flat.find((i) => i.id === selectedId)
        if (sel) {
          e.preventDefault()
          onOpen(sel)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flat, selectedId, onCreate, onOpen])

  const glyphFor = useCallback(
    (g: { key: string }) =>
      groupBy === 'status' || view === 'board'
        ? <StatusIcon status={g.key as never} size={14} />
        : groupBy === 'priority'
          ? <PriorityIcon priority={g.key as never} size={13} />
          : undefined,
    [groupBy, view],
  )

  return (
    <YStack gap="$4">
      {header}
      <Toolbar
        ref={searchRef}
        view={view}
        onView={setView}
        groupBy={groupBy}
        onGroupBy={setGroupBy}
        filters={filters}
        onFilters={setFilters}
        query={query}
        onQuery={setQuery}
        assignees={assignees}
        labels={labels}
        actions={
          <>
            <Button size="$2" icon={<RefreshCw size={14} />} onPress={onReload} aria-label="Refresh" />
            {actions}
            <Button size="$2" icon={<Plus size={14} />} onPress={onCreate}>
              New issue
            </Button>
          </>
        }
      />
      {filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={issues.length === 0 ? 'No issues yet' : 'No issues match'}
          description={
            issues.length === 0
              ? 'Create an issue, or connect GitHub so every repo’s issues flow in here.'
              : 'Adjust the filters or search to see issues.'
          }
          primary={issues.length === 0 ? { label: 'New issue', icon: <Plus size={15} />, onPress: onCreate } : undefined}
        />
      ) : view === 'board' ? (
        <Board columns={groups} projects={projects} selectedId={selectedId} showTeam={showTeam} glyphFor={glyphFor} onOpen={onOpen} />
      ) : (
        <GroupedList
          groups={groups}
          projects={projects}
          selectedId={selectedId}
          showTeam={showTeam}
          keepEmpty={groupBy === 'status'}
          glyphFor={glyphFor}
          onOpen={onOpen}
        />
      )}
    </YStack>
  )
}

// ── Teams (KEY-prefixed projects) ────────────────────────────────────────────

export function TeamsView({
  projects,
  issues,
  loading,
  onOpenTeam,
  onReload,
  onSyncGitHub,
  syncing,
}: {
  projects: Project[]
  issues: Issue[]
  loading: boolean
  onOpenTeam: (key: string) => void
  onReload: () => void
  onSyncGitHub: () => void
  syncing: boolean
}) {
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const counts = useMemo(() => {
    const m = new Map<string, { total: number; open: number }>()
    for (const i of issues) {
      const c = m.get(i.projectKey) ?? { total: 0, open: 0 }
      c.total += 1
      if (i.status !== 'done' && i.status !== 'canceled') c.open += 1
      m.set(i.projectKey, c)
    }
    return m
  }, [issues])

  const reset = () => {
    setKey('')
    setName('')
    setDescription('')
    setCreating(false)
  }
  const create = async () => {
    const n = name.trim()
    if (!n) {
      toast.error('Name required', 'Give the team a name.')
      return
    }
    setBusy(true)
    try {
      const payload: NewProject = { name: n, description: description.trim() || undefined, ...(key.trim() ? { key: key.trim().toUpperCase() } : {}) }
      const created = await TrackerApi.createProject(payload)
      toast.success('Team created', `${created.key} · ${created.name}`)
      reset()
      onReload()
    } catch (e) {
      toast.error('Could not create team', asApiError(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <YStack gap="$4">
      <PageHeader
        title="Teams"
        subtitle="Each team groups issues under a KEY (ENG-1, ENG-2…). GitHub-mirrored repos share the GH team."
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$2" icon={<RefreshCw size={14} />} onPress={onReload} aria-label="Refresh" />
            <Button size="$2" icon={<Github size={14} />} onPress={onSyncGitHub} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync GitHub'}
            </Button>
            <Button size="$2" icon={<Plus size={14} />} onPress={() => setCreating((v) => !v)}>
              New team
            </Button>
          </XStack>
        }
      />
      {creating ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" maxW={640}>
          <Text fontSize="$5" fontWeight="700">
            New team
          </Text>
          <FieldRow label="Key (optional)">
            <FieldText value={key} onChange={setKey} placeholder="ENG" disabled={busy} />
          </FieldRow>
          <FieldRow label="Name">
            <FieldText value={name} onChange={setName} placeholder="Engineering" disabled={busy} />
          </FieldRow>
          <FieldRow label="Description">
            <FieldTextArea value={description} onChange={setDescription} rows={3} disabled={busy} />
          </FieldRow>
          <Text fontSize="$2" color="$color10">
            The key is uppercase (A–Z then A–Z0–9, 2–8 chars) and prefixes every issue (ENG-1). Omit it to derive one from the name.
          </Text>
          <XStack gap="$2">
            <PrimaryButton disabled={busy} onPress={() => void create()}>
              {busy ? 'Creating…' : 'Create team'}
            </PrimaryButton>
            <Button chromeless disabled={busy} onPress={reset}>
              Cancel
            </Button>
          </XStack>
        </Card>
      ) : null}
      {!loading && projects.length === 0 && !creating ? (
        <EmptyState
          icon={ClipboardList}
          title="No teams yet"
          description="A team groups issues under a key. Create one, or Sync GitHub to mirror every repo’s issues into the GH team."
          primary={{ label: 'New team', icon: <Plus size={15} />, onPress: () => setCreating(true) }}
        />
      ) : (
        <YStack gap="$2">
          {projects.map((p) => {
            const c = counts.get(p.key) ?? { total: 0, open: 0 }
            return (
              <Card
                key={p.key}
                p="$3.5"
                gap="$2"
                borderWidth={1}
                borderColor="$borderColor"
                hoverStyle={{ borderColor: '$color8' }}
                cursor="pointer"
                onPress={() => onOpenTeam(p.key)}
              >
                <XStack items="center" gap="$2.5">
                  <XStack items="center" justify="center" width={34} height={34} rounded="$3" bg="$color4">
                    <Text className="hz-mono" fontSize="$3" fontWeight="800" color="$color12">
                      {p.key.slice(0, 3)}
                    </Text>
                  </XStack>
                  <YStack flex={1} minW={0}>
                    <Text fontSize="$4" fontWeight="700" color="$color12" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text fontSize="$2" color="$color10" numberOfLines={1}>
                      {p.description || `${p.key} · updated ${relTime(p.updatedAt)}`}
                    </Text>
                  </YStack>
                  <YStack items="flex-end">
                    <Text fontSize="$4" fontWeight="700" color="$color12">
                      {c.open}
                    </Text>
                    <Text fontSize="$1" color="$color9">
                      open · {c.total} total
                    </Text>
                  </YStack>
                </XStack>
              </Card>
            )
          })}
        </YStack>
      )}
    </YStack>
  )
}

// ── Cycles (derived current cycle) ───────────────────────────────────────────

export function CyclesView({
  issues,
  projects,
  onOpen,
}: {
  issues: Issue[]
  projects: Project[]
  onOpen: (i: Issue) => void
}) {
  const cycle = useMemo(() => deriveCurrentCycle(issues), [issues])
  const groups = useMemo(() => groupIssues(cycle.active, 'status'), [cycle.active])
  return (
    <YStack gap="$4">
      <PageHeader
        title="Current cycle"
        subtitle="A rolling two-week iteration, derived from recently-updated work. Progress is the share already done."
      />
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$3" flexWrap="wrap">
          <XStack items="center" gap="$2">
            <Target size={16} />
            <Text fontSize="$5" fontWeight="700" color="$color12">
              {cycle.done}/{cycle.total} done
            </Text>
          </XStack>
          <ProgressBar value={cycle.progress} width={220} />
          <Text fontSize="$2" color="$color10">
            {Math.round(cycle.progress * 100)}% · {cycle.active.length} active
          </Text>
        </XStack>
      </Card>
      {cycle.active.length === 0 ? (
        <EmptyState
          icon={Target}
          title="Nothing active this cycle"
          description="Move issues to Todo or In Progress to bring them into the current cycle."
        />
      ) : (
        <GroupedList
          groups={groups}
          projects={projects}
          keepEmpty={false}
          showTeam
          glyphFor={(g) => <StatusIcon status={g.key as never} size={14} />}
          onOpen={onOpen}
        />
      )}
    </YStack>
  )
}

// ── Roadmap (epics + children) ───────────────────────────────────────────────

export function RoadmapView({ issues, projects, onOpen }: { issues: Issue[]; projects: Project[]; onOpen: (i: Issue) => void }) {
  const rows = useMemo(() => deriveRoadmap(issues), [issues])
  return (
    <YStack gap="$4">
      <PageHeader
        title="Roadmap"
        subtitle="Epics and the issues that roll up to them (a child’s ExtRef anchors its epic)."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No epics yet"
          description="Create an issue with kind “epic”, then set a child issue’s ExtRef to the epic’s identifier to roll it up here."
        />
      ) : (
        <YStack gap="$2.5">
          {rows.map((r) => (
            <Card key={r.epic.id} p="$3.5" gap="$3" borderWidth={1} borderColor="$borderColor">
              <XStack
                items="center"
                gap="$2.5"
                cursor="pointer"
                onPress={() => onOpen(r.epic)}
                hoverStyle={{ opacity: 0.85 }}
              >
                <Layers size={16} />
                <YStack flex={1} minW={0}>
                  <XStack items="center" gap="$2">
                    <Identifier id={r.epic.identifier} />
                    <Text fontSize="$4" fontWeight="700" color="$color12" numberOfLines={1}>
                      {r.epic.title}
                    </Text>
                  </XStack>
                </YStack>
                <Text fontSize="$2" color="$color10">
                  {r.done}/{r.total}
                </Text>
                <ProgressBar value={r.progress} width={140} />
              </XStack>
              {r.children.length > 0 ? (
                <YStack gap="$0.5" pl="$6">
                  {r.children.slice(0, 6).map((c) => (
                    <XStack
                      key={c.id}
                      items="center"
                      gap="$2"
                      py="$1"
                      cursor="pointer"
                      hoverStyle={{ opacity: 0.8 }}
                      onPress={() => onOpen(c)}
                    >
                      <StatusIcon status={c.status} size={13} />
                      <Identifier id={c.identifier} muted />
                      <Text flex={1} fontSize="$2" color="$color11" numberOfLines={1}>
                        {c.title}
                      </Text>
                      <Text fontSize="$1" color="$color9">
                        {STATUS_LABEL[c.status]}
                      </Text>
                    </XStack>
                  ))}
                  {r.children.length > 6 ? (
                    <Text fontSize="$1" color="$color9" pl="$5">
                      +{r.children.length - 6} more
                    </Text>
                  ) : null}
                </YStack>
              ) : null}
            </Card>
          ))}
        </YStack>
      )}
    </YStack>
  )
}

/** A back-to-teams header used by the single-team board. */
export function TeamHeader({ project, onBack }: { project: Project; onBack: () => void }) {
  return (
    <PageHeader
      title={project.name}
      subtitle={`${project.key} · ${project.description || 'Team board — grouped by status. Press “c” to create an issue.'}`}
      actions={
        <Button size="$2" chromeless icon={<ArrowLeft size={15} />} onPress={onBack}>
          Teams
        </Button>
      }
    />
  )
}
