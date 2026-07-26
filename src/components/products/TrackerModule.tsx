'use client'

/**
 * Tracker — a NATIVE @hanzo/gui issue tracker over the REAL cloud `/v1/tracker`
 * surface (projects + issues on Base/SQLite). It is the replacement for the old
 * Huly/Svelte hanzo.team tracker, whose load-bearing failure was that it could not
 * render issue ROWS GROUPED BY STATUS. This one does: for a selected project it
 * fetches every issue and lays them out one section per status — the grouped List
 * is the proof view, and a Board toggle renders the SAME data as five columns.
 *
 * Every read/write is same-origin and keyless (`TrackerApi` → `<origin>/v1/tracker`,
 * rewritten to the console's user-bearer `/v1` proxy), so every row is org-scoped
 * SERVER-SIDE and no credential reaches the browser. Honest by construction: rows are
 * the real `/v1/tracker` payload; a failed load surfaces `ErrorState`, a genuinely
 * empty org shows `EmptyState` — never a fabricated project or issue.
 *
 * Keyboard-first (Linear convention): inside a project, `c` opens the create-issue
 * SlideOver. (⌘K stays owned by the global CommandPalette — hijacking it would fight
 * the palette toggle, so the module uses Linear's own create shortcut instead.)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { ClipboardList, LayoutGrid, ListChecks, Plus, RefreshCw, Trash2 } from '@hanzogui/lucide-icons-2'

import {
  TrackerApi,
  STATUSES,
  PRIORITIES,
  type Project,
  type Issue,
  type Status,
  type Priority,
  type NewProject,
  type NewIssue,
} from '~/lib/api/tracker'
import { ApiError } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldRow, FieldText, FieldTextArea, FieldSelect } from '~/components/ui/Field'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { EmptyState } from '~/components/ui/EmptyState'
import { SlideOver } from '~/components/ui/SlideOver'
import { ErrorState, asApiError } from '~/components/ui/States'
import { useToast } from '~/components/ui/Toast'

// ── Presentation tokens (as-const so the literal token types satisfy the GUI
//    color union, exactly like StatusTag's TONE maps) ─────────────────────────
const STATUS_LABEL: Record<Status, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  canceled: 'Canceled',
}
const STATUS_DOT = {
  backlog: '$color8',
  todo: '$color11',
  in_progress: '$yellow10',
  done: '$green10',
  canceled: '$red10',
} as const
const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority',
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}
const PRIORITY_COLOR = {
  none: '$color9',
  urgent: '$red10',
  high: '$yellow10',
  medium: '$yellow10',
  low: '$color10',
} as const

/** Format an epoch timestamp (seconds OR milliseconds) as a local date. */
const fmtDate = (ts?: number): string => {
  if (!ts) return '—'
  const d = new Date(ts < 1e12 ? ts * 1000 : ts)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

/** Split a comma input into a clean label list. */
const parseLabels = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)

// ── Small presentational atoms ───────────────────────────────────────────────

function Dot({ status }: { status: Status }) {
  return <YStack width={9} height={9} rounded="$10" bg={STATUS_DOT[status]} />
}

function PriorityTag({ priority }: { priority: Priority }) {
  if (priority === 'none') return <Text fontSize="$2" color="$color9">—</Text>
  return (
    <XStack items="center" gap="$1.5" px="$2" py="$0.5" rounded="$3" bg="$color3">
      <YStack width={6} height={6} rounded="$10" bg={PRIORITY_COLOR[priority]} />
      <Text fontSize="$1" color="$color11" fontWeight="500">
        {PRIORITY_LABEL[priority]}
      </Text>
    </XStack>
  )
}

function LabelChips({ labels }: { labels: string[] }) {
  if (labels.length === 0) return <Text fontSize="$2" color="$color9">—</Text>
  return (
    <XStack gap="$1" flexWrap="wrap">
      {labels.map((l) => (
        <Text key={l} fontSize="$1" px="$1.5" py="$0.5" rounded="$2" bg="$color3" color="$color11" numberOfLines={1}>
          {l}
        </Text>
      ))}
    </XStack>
  )
}

/** Issue table columns — identifier is mono; priority/labels are tags. */
const issueColumns: Column<Issue>[] = [
  {
    key: 'identifier',
    header: 'ID',
    width: 96,
    render: (i) => (
      <Text className="hz-mono" fontSize="$2" color="$color11" numberOfLines={1}>
        {i.identifier}
      </Text>
    ),
  },
  {
    key: 'title',
    header: 'Title',
    render: (i) => (
      <Text fontSize="$3" color="$color12" numberOfLines={1}>
        {i.title}
      </Text>
    ),
  },
  { key: 'priority', header: 'Priority', width: 130, render: (i) => <PriorityTag priority={i.priority} /> },
  {
    key: 'assignee',
    header: 'Assignee',
    width: 150,
    render: (i) => (
      <Text fontSize="$3" color="$color11" numberOfLines={1}>
        {i.assignee || '—'}
      </Text>
    ),
  },
  { key: 'labels', header: 'Labels', width: 200, render: (i) => <LabelChips labels={i.labels} /> },
]

// ── Grouped LIST view — one section per status (THE proof) ────────────────────

function StatusSection({ status, issues, onOpen }: { status: Status; issues: Issue[]; onOpen: (i: Issue) => void }) {
  return (
    <YStack gap="$2">
      <XStack items="center" gap="$2">
        <Dot status={status} />
        <Text fontSize="$3" fontWeight="600" color="$color12">
          {STATUS_LABEL[status]}
        </Text>
        <Text fontSize="$2" color="$color10">
          {issues.length}
        </Text>
      </XStack>
      {issues.length > 0 ? (
        <DataTable columns={issueColumns} rows={issues} rowKey={(i) => i.id} onRowPress={onOpen} />
      ) : (
        <Text fontSize="$2" color="$color9" pl="$5">
          No issues
        </Text>
      )}
    </YStack>
  )
}

// ── BOARD view — same data, five columns ─────────────────────────────────────

function BoardColumn({ status, issues, onOpen }: { status: Status; issues: Issue[]; onOpen: (i: Issue) => void }) {
  return (
    <YStack width={280} minW={280} gap="$2">
      <XStack items="center" gap="$2" px="$1">
        <Dot status={status} />
        <Text flex={1} fontSize="$3" fontWeight="600" color="$color12">
          {STATUS_LABEL[status]}
        </Text>
        <Text fontSize="$2" color="$color10">
          {issues.length}
        </Text>
      </XStack>
      <YStack gap="$2">
        {issues.length === 0 ? (
          <YStack borderWidth={1} borderColor="$borderColor" borderStyle="dashed" rounded="$4" py="$4" items="center">
            <Text fontSize="$2" color="$color9">
              No issues
            </Text>
          </YStack>
        ) : (
          issues.map((i) => (
            <Card
              key={i.id}
              p="$3"
              gap="$2"
              bg="$color1"
              borderWidth={1}
              borderColor="$borderColor"
              hoverStyle={{ borderColor: '$color8' }}
              cursor="pointer"
              onPress={() => onOpen(i)}
            >
              <XStack items="center" justify="space-between" gap="$2">
                <Text className="hz-mono" fontSize="$1" color="$color10">
                  {i.identifier}
                </Text>
                <PriorityTag priority={i.priority} />
              </XStack>
              <Text fontSize="$3" color="$color12" numberOfLines={2}>
                {i.title}
              </Text>
              {i.assignee || i.labels.length > 0 ? (
                <XStack items="center" justify="space-between" gap="$2">
                  <LabelChips labels={i.labels} />
                  {i.assignee ? (
                    <Text fontSize="$2" color="$color11" numberOfLines={1}>
                      {i.assignee}
                    </Text>
                  ) : null}
                </XStack>
              ) : null}
            </Card>
          ))
        )}
      </YStack>
    </YStack>
  )
}

// ── Create / edit issue form (inside a SlideOver) ────────────────────────────

function IssueForm({
  projectKey,
  issue,
  onClose,
  onSaved,
  onDeleted,
}: {
  projectKey: string
  /** null = create; an issue = edit. */
  issue: Issue | null
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const toast = useToast()
  const [title, setTitle] = useState(issue?.title ?? '')
  const [description, setDescription] = useState(issue?.description ?? '')
  const [status, setStatus] = useState<Status>(issue?.status ?? 'backlog')
  const [priority, setPriority] = useState<Priority>(issue?.priority ?? 'none')
  const [assignee, setAssignee] = useState(issue?.assignee ?? '')
  const [labels, setLabels] = useState((issue?.labels ?? []).join(', '))
  const [busy, setBusy] = useState(false)

  const body = (): NewIssue => ({
    title: title.trim(),
    description: description.trim() || undefined,
    status,
    priority,
    assignee: assignee.trim() || undefined,
    labels: parseLabels(labels),
  })

  const save = async () => {
    if (!title.trim()) {
      toast.error('Title required', 'Give the issue a title.')
      return
    }
    setBusy(true)
    try {
      if (issue) {
        await TrackerApi.updateIssue(projectKey, issue.number, body())
        toast.success('Issue updated', issue.identifier)
      } else {
        const created = await TrackerApi.createIssue(projectKey, body())
        toast.success('Issue created', created.identifier)
      }
      onSaved()
    } catch (e) {
      toast.error(issue ? 'Could not update issue' : 'Could not create issue', asApiError(e).message)
    } finally {
      setBusy(false)
    }
  }

  // Quick status change (edit only) — PATCH just the status, then refetch so the
  // issue moves between groups/columns. This is the one-click status control.
  const quickStatus = async (s: Status) => {
    setStatus(s)
    if (!issue) return
    try {
      await TrackerApi.updateIssue(projectKey, issue.number, { status: s })
      toast.success('Status updated', `${issue.identifier} → ${STATUS_LABEL[s]}`)
      onSaved()
    } catch (e) {
      toast.error('Could not update status', asApiError(e).message)
    }
  }

  const remove = async () => {
    if (!issue) return
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${issue.identifier}? This cannot be undone.`)) return
    try {
      await TrackerApi.deleteIssue(projectKey, issue.number)
      toast.success('Issue deleted', issue.identifier)
      onDeleted()
    } catch (e) {
      toast.error('Could not delete issue', asApiError(e).message)
    }
  }

  return (
    <YStack gap="$3">
      {issue ? (
        <YStack gap="$1.5">
          <Text fontSize="$2" color="$color10">
            Quick status
          </Text>
          <XStack gap="$1.5" flexWrap="wrap">
            {STATUSES.map((s) => (
              <Button key={s} size="$2" theme={status === s ? 'light' : undefined} onPress={() => void quickStatus(s)}>
                {STATUS_LABEL[s]}
              </Button>
            ))}
          </XStack>
        </YStack>
      ) : null}
      <FieldRow label="Title">
        <FieldText value={title} onChange={setTitle} placeholder="Fix the login redirect" disabled={busy} />
      </FieldRow>
      <FieldRow label="Description">
        <FieldTextArea value={description} onChange={setDescription} rows={4} disabled={busy} />
      </FieldRow>
      <FieldRow label="Status">
        <FieldSelect value={status} options={[...STATUSES]} onChange={(v) => setStatus(v as Status)} disabled={busy} />
      </FieldRow>
      <FieldRow label="Priority">
        <FieldSelect value={priority} options={[...PRIORITIES]} onChange={(v) => setPriority(v as Priority)} disabled={busy} />
      </FieldRow>
      <FieldRow label="Assignee">
        <FieldText value={assignee} onChange={setAssignee} placeholder="ada@hanzo.ai" disabled={busy} />
      </FieldRow>
      <FieldRow label="Labels">
        <FieldText value={labels} onChange={setLabels} placeholder="bug, auth, p1" disabled={busy} />
      </FieldRow>
      <XStack gap="$2" justify="space-between" flexWrap="wrap">
        <XStack gap="$2">
          <PrimaryButton disabled={busy} onPress={() => void save()}>
            {busy ? 'Saving…' : issue ? 'Save changes' : 'Create issue'}
          </PrimaryButton>
          <Button chromeless disabled={busy} onPress={onClose}>
            Cancel
          </Button>
        </XStack>
        {issue ? (
          <Button theme="red" icon={<Trash2 size={15} />} disabled={busy} onPress={() => void remove()}>
            Delete
          </Button>
        ) : null}
      </XStack>
    </YStack>
  )
}

// ── Project board (issues for one project) ───────────────────────────────────

type Editing = { mode: 'create' } | { mode: 'edit'; issue: Issue }

function ProjectBoard({ project, onBack, onDeletedProject }: { project: Project; onBack: () => void; onDeletedProject: () => void }) {
  const toast = useToast()
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [view, setView] = useState<'list' | 'board'>('list')
  const [editing, setEditing] = useState<Editing | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    TrackerApi.listIssues(project.key)
      .then((data) => {
        setIssues(data)
        setError(null)
      })
      .catch((e) => setError(asApiError(e)))
      .finally(() => setLoading(false))
  }, [project.key])
  useEffect(() => {
    load()
  }, [load])

  // Keyboard-first: `c` opens the create-issue SlideOver (Linear's create shortcut),
  // when no editable element is focused and the drawer isn't already open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (editing) return
      e.preventDefault()
      setEditing({ mode: 'create' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const grouped = useMemo(() => {
    const g: Record<Status, Issue[]> = { backlog: [], todo: [], in_progress: [], done: [], canceled: [] }
    for (const i of issues) g[i.status].push(i)
    return g
  }, [issues])

  const openEdit = useCallback((issue: Issue) => setEditing({ mode: 'edit', issue }), [])

  const removeProject = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete project “${project.name}” (${project.key}) and all its issues?`)) return
    try {
      await TrackerApi.deleteProject(project.key)
      toast.success('Project deleted', project.key)
      onDeletedProject()
    } catch (e) {
      toast.error('Could not delete project', asApiError(e).message)
    }
  }

  const total = issues.length

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={`${project.key} · ${total} issue${total === 1 ? '' : 's'} — grouped by status. Press “c” to create an issue.`}
        actions={
          // Full-width on phones so the button row WRAPS inside the header instead of
          // overflowing (PageHeader gives this its own line < $md); inline at $md+.
          <XStack gap="$2" items="center" flexWrap="wrap" width="100%" $md={{ width: 'auto' }}>
            <Button size="$2" chromeless onPress={onBack}>
              ← Projects
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <XStack gap="$1">
              <Button
                size="$2"
                theme={view === 'list' ? 'light' : undefined}
                chromeless={view !== 'list'}
                icon={<ListChecks size={15} />}
                onPress={() => setView('list')}
              >
                List
              </Button>
              <Button
                size="$2"
                theme={view === 'board' ? 'light' : undefined}
                chromeless={view !== 'board'}
                icon={<LayoutGrid size={15} />}
                onPress={() => setView('board')}
              >
                Board
              </Button>
            </XStack>
            <Button size="$2" icon={<Plus size={15} />} onPress={() => setEditing({ mode: 'create' })}>
              New issue
            </Button>
            <Button
              size="$2"
              chromeless
              theme="red"
              icon={<Trash2 size={15} />}
              onPress={() => void removeProject()}
              aria-label="Delete project"
            />
          </XStack>
        }
      />

      {error ? (
        <ErrorState
          err={error}
          onRetry={load}
          copy={{ notFound: 'The tracker service is not routed on this deployment yet.' }}
        />
      ) : loading ? (
        <DataTable columns={issueColumns} rows={[]} loading rowKey={(i) => i.id} />
      ) : view === 'list' ? (
        <YStack gap="$5">
          {STATUSES.map((s) => (
            <StatusSection key={s} status={s} issues={grouped[s]} onOpen={openEdit} />
          ))}
        </YStack>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <XStack gap="$3" py="$1">
            {STATUSES.map((s) => (
              <BoardColumn key={s} status={s} issues={grouped[s]} onOpen={openEdit} />
            ))}
          </XStack>
        </ScrollView>
      )}

      <SlideOver
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.mode === 'edit' ? editing.issue.identifier : 'New issue'}
        icon={ClipboardList}
        size={520}
      >
        {editing ? (
          <IssueForm
            projectKey={project.key}
            issue={editing.mode === 'edit' ? editing.issue : null}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              load()
            }}
            onDeleted={() => {
              setEditing(null)
              load()
            }}
          />
        ) : null}
      </SlideOver>
    </>
  )
}

// ── Project list ─────────────────────────────────────────────────────────────

function ProjectsPane({ onOpen }: { onOpen: (p: Project) => void }) {
  const toast = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [creating, setCreating] = useState(false)
  const [projKey, setProjKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    TrackerApi.listProjects()
      .then((data) => {
        setProjects(data)
        setError(null)
      })
      .catch((e) => setError(asApiError(e)))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const reset = () => {
    setProjKey('')
    setName('')
    setDescription('')
    setCreating(false)
  }

  const create = async () => {
    const n = name.trim()
    if (!n) {
      toast.error('Name required', 'Give the project a name.')
      return
    }
    const k = projKey.trim().toUpperCase()
    setBusy(true)
    try {
      const payload: NewProject = { name: n, description: description.trim() || undefined, ...(k ? { key: k } : {}) }
      const created = await TrackerApi.createProject(payload)
      toast.success('Project created', `${created.key} · ${created.name}`)
      reset()
      load()
    } catch (e) {
      toast.error('Could not create project', asApiError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Project>[] = [
    {
      key: 'key',
      header: 'Key',
      width: 110,
      render: (p) => (
        <Text className="hz-mono" fontSize="$3" fontWeight="600" color="$color12">
          {p.key}
        </Text>
      ),
    },
    {
      key: 'name',
      header: 'Project',
      render: (p) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {p.name}
        </Text>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (p) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {p.description || '—'}
        </Text>
      ),
    },
    {
      key: 'updated',
      header: 'Updated',
      width: 130,
      render: (p) => (
        <Text fontSize="$3" color="$color11">
          {fmtDate(p.updatedAt)}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Tracker"
        subtitle="Projects and issues — a native tracker with issue rows grouped by status. Select a project to open its board."
        actions={
          !error ? (
            <Button icon={<Plus size={16} />} onPress={() => setCreating((v) => !v)}>
              New project
            </Button>
          ) : undefined
        }
      />

      {creating && !error ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" maxWidth={640}>
          <Text fontSize="$5" fontWeight="700">
            New project
          </Text>
          <FieldRow label="Key (optional)">
            <FieldText value={projKey} onChange={setProjKey} placeholder="ENG" disabled={busy} />
          </FieldRow>
          <FieldRow label="Name">
            <FieldText value={name} onChange={setName} placeholder="Engineering" disabled={busy} />
          </FieldRow>
          <FieldRow label="Description">
            <FieldTextArea value={description} onChange={setDescription} rows={3} disabled={busy} />
          </FieldRow>
          <Text fontSize="$2" color="$color10">
            The key is uppercase (A–Z, then A–Z0–9, 2–8 chars) and prefixes every issue (ENG-1). Omit it to derive one from the name.
          </Text>
          <XStack gap="$2">
            <PrimaryButton disabled={busy} onPress={() => void create()}>
              {busy ? 'Creating…' : 'Create project'}
            </PrimaryButton>
            <Button chromeless disabled={busy} onPress={reset}>
              Cancel
            </Button>
          </XStack>
        </Card>
      ) : null}

      {error ? (
        <ErrorState
          err={error}
          onRetry={load}
          copy={{
            notFound:
              'The tracker service is not routed on this deployment yet. It appears automatically once the deployment proxies /v1/tracker through the gateway.',
          }}
        />
      ) : !loading && projects.length === 0 && !creating ? (
        <EmptyState
          icon={ClipboardList}
          title="No projects yet"
          description="A project groups issues under a key (ENG-1, ENG-2…). Create one to open its status board."
          bullets={[
            'Issues are grouped by status: Backlog · Todo · In Progress · Done · Canceled',
            'Switch between a grouped List and a Board',
            'Press “c” inside a project to create an issue',
          ]}
          primary={{ label: 'New project', icon: <Plus size={15} />, onPress: () => setCreating(true) }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={projects}
          loading={loading}
          rowKey={(p) => p.key}
          onRowPress={onOpen}
          empty="No projects yet. Create one to start tracking issues."
        />
      )}
    </>
  )
}

// ── Module ───────────────────────────────────────────────────────────────────

export function TrackerModule(_props: { params: Record<string, string> }) {
  const [selected, setSelected] = useState<Project | null>(null)
  return selected ? (
    <ProjectBoard project={selected} onBack={() => setSelected(null)} onDeletedProject={() => setSelected(null)} />
  ) : (
    <ProjectsPane onOpen={setSelected} />
  )
}

