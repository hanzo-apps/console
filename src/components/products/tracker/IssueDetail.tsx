'use client'

/**
 * Issue detail — the Linear-style pane (create OR view/edit) for one work item. It
 * owns the write surface (title/description/status/priority/assignee/labels), the
 * one-click status control, and the AGENT + GIT linkage that makes an issue
 * actionable: hand an issue to the coding agent (assignee + `agent` label → the
 * cloud coding seam picks it up and opens a linked PR), see the issue↔branch↔PR
 * chain (`linkedPRs`), and jump to the native git.hanzo.ai repo or the upstream
 * GitHub source. Honest states throughout — no fabricated activity, real writes over
 * `/v1/todo`.
 */
import { useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Bot, ExternalLink, GitBranch, Github, Trash2, GitPullRequest, Layers } from '@hanzogui/lucide-icons-2'

import {
  TrackerApi,
  STATUSES,
  PRIORITIES,
  type Issue,
  type Project,
  type Status,
  type Priority,
  type NewIssue,
} from '~/lib/api/tracker'
import { asApiError } from '~/components/ui/States'
import { useToast } from '~/components/ui/Toast'
import {
  STATUS_LABEL,
  PRIORITY_LABEL,
  KIND_LABEL,
  SOURCE_LABEL,
  parseLabels,
  githubUrl,
  gitHanzoUrl,
  linkedPRs,
} from './logic'
import { StatusIcon, KindIcon, SourceBadge, Identifier, PriorityIcon } from './atoms'
import { FieldRow, FieldSelect, FieldText, FieldTextArea, PrimaryButton } from '@hanzo/ui/product'

/** The default coding-agent ref an issue is handed to (assignee). */
const AGENT_REF = 'hanzo'

function openTab(url: string | null) {
  if (url && typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
}

/** A labeled external-link button (GitHub / native git / PR). */
function LinkButton({ icon, label, url }: { icon: React.ReactElement; label: string; url: string | null }) {
  if (!url) return null
  return (
    <Button size="$2" icon={icon} iconAfter={<ExternalLink size={12} opacity={0.5} />} onPress={() => openTab(url)}>
      {label}
    </Button>
  )
}

/** A read-only key/value meta row in the detail sidebar. */
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <XStack items="center" justify="space-between" gap="$3">
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      {children}
    </XStack>
  )
}

/** A compact linked-PR / child-issue row inside the detail. */
function LinkRow({ issue, onOpen }: { issue: Issue; onOpen?: (i: Issue) => void }) {
  return (
    <XStack
      items="center"
      gap="$2"
      px="$2"
      py="$1.5"
      rounded="$3"
      hoverStyle={{ bg: '$color3' }}
      cursor={onOpen ? 'pointer' : 'default'}
      onPress={() => onOpen?.(issue)}
    >
      {issue.kind === 'pr' ? <KindIcon kind="pr" size={14} /> : <StatusIcon status={issue.status} size={14} />}
      <Identifier id={issue.identifier} />
      <Text flex={1} fontSize="$2" color="$color12" numberOfLines={1}>
        {issue.title}
      </Text>
      <SourceBadge source={issue.source} />
    </XStack>
  )
}

export function IssueDetail({
  projectKey,
  issue,
  allIssues,
  onClose,
  onSaved,
  onDeleted,
  onOpenIssue,
}: {
  projectKey: string
  /** null = create; an issue = view/edit. */
  issue: Issue | null
  /** the full working set, for deriving linked PRs / epic children. */
  allIssues: Issue[]
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  onOpenIssue?: (i: Issue) => void
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

  // One-click status (edit only) — PATCH just the status; the row moves group/column.
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

  // Hand the issue to the coding agent: assignee + the `agent` label. The cloud coding
  // seam (clients/coding) picks it up, works on a native git.hanzo.ai branch, and opens
  // a linked PR row (Kind:"pr", Source:"agent", same Repo) — surfaced below once it lands.
  const handToAgent = async () => {
    if (!issue) return
    setBusy(true)
    try {
      await TrackerApi.assignAgent(projectKey, issue.number, AGENT_REF, issue.labels)
      setAssignee(AGENT_REF)
      toast.success('Handed to agent', `${issue.identifier} → @${AGENT_REF}. A linked PR opens when the run completes.`)
      onSaved()
    } catch (e) {
      toast.error('Could not assign agent', asApiError(e).message)
    } finally {
      setBusy(false)
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

  const prs = issue ? linkedPRs(issue, allIssues) : []
  const children =
    issue && issue.kind === 'epic'
      ? allIssues.filter((i) => i.id !== issue.id && (i.extRef === issue.identifier || i.extRef === issue.id))
      : []
  const gh = issue ? githubUrl(issue) : null
  const git = issue ? gitHanzoUrl(issue.repo) : null
  const isAgentPr = issue?.kind === 'pr' && issue.source === 'agent'
  const handedToAgent = (issue?.assignee ?? '').trim().toLowerCase() === AGENT_REF || issue?.labels.includes('agent')

  return (
    <YStack gap="$3">
      {issue ? (
        <>
          {/* Identity header */}
          <XStack items="center" gap="$2" flexWrap="wrap">
            <Identifier id={issue.identifier} />
            <XStack items="center" gap="$1.5" px="$1.5" py="$0.5" rounded="$3" bg="$color3">
              <KindIcon kind={issue.kind} size={13} />
              <Text fontSize="$1" color="$color11" fontWeight="600">
                {KIND_LABEL[issue.kind]}
              </Text>
            </XStack>
            <SourceBadge source={issue.source} />
          </XStack>

          {/* One-click status */}
          <YStack gap="$1.5">
            <Text fontSize="$2" color="$color10">
              Status
            </Text>
            <XStack gap="$1.5" flexWrap="wrap">
              {STATUSES.map((s) => (
                <Button
                  key={s}
                  size="$2"
                  theme={status === s ? 'light' : undefined}
                  chromeless={status !== s}
                  icon={<StatusIcon status={s} size={13} />}
                  onPress={() => void quickStatus(s)}
                >
                  {STATUS_LABEL[s]}
                </Button>
              ))}
            </XStack>
          </YStack>
        </>
      ) : null}

      <FieldRow label="Title">
        <FieldText value={title} onChange={setTitle} placeholder="Fix the login redirect" disabled={busy} />
      </FieldRow>
      <FieldRow label="Description">
        <FieldTextArea value={description} onChange={setDescription} rows={5} disabled={busy} />
      </FieldRow>
      <XStack gap="$2" flexWrap="wrap">
        <YStack flex={1} minW={160}>
          <FieldRow label="Status">
            <FieldSelect value={status} options={[...STATUSES]} onChange={(v) => setStatus(v as Status)} disabled={busy} />
          </FieldRow>
        </YStack>
        <YStack flex={1} minW={160}>
          <FieldRow label="Priority">
            <FieldSelect value={priority} options={[...PRIORITIES]} onChange={(v) => setPriority(v as Priority)} disabled={busy} />
          </FieldRow>
        </YStack>
      </XStack>
      <FieldRow label="Assignee">
        <FieldText value={assignee} onChange={setAssignee} placeholder="ada@hanzo.ai" disabled={busy} />
      </FieldRow>
      <FieldRow label="Labels">
        <FieldText value={labels} onChange={setLabels} placeholder="bug, auth, p1" disabled={busy} />
      </FieldRow>

      {/* Save / cancel / delete */}
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
          <Button theme="red" chromeless icon={<Trash2 size={15} />} disabled={busy} onPress={() => void remove()} aria-label="Delete issue" />
        ) : null}
      </XStack>

      {/* ── Agent + git linkage (edit only) ─────────────────────────────────── */}
      {issue ? (
        <Card p="$3" gap="$3" bg="$color1" borderWidth={1} borderColor="$borderColor">
          <XStack items="center" gap="$2">
            <Bot size={15} />
            <Text fontSize="$3" fontWeight="700" color="$color12">
              Agent &amp; git
            </Text>
          </XStack>

          {issue.repo ? (
            <Meta label="Repo">
              <Text fontSize="$2" color="$color12" className="hz-mono">
                {issue.repo}
              </Text>
            </Meta>
          ) : null}
          {isAgentPr && issue.extRef ? (
            <Meta label="Branch">
              <XStack items="center" gap="$1.5">
                <GitBranch size={13} />
                <Text fontSize="$2" color="$color12" className="hz-mono" numberOfLines={1}>
                  {issue.extRef}
                </Text>
              </XStack>
            </Meta>
          ) : null}

          <XStack gap="$2" flexWrap="wrap">
            <LinkButton icon={<GitBranch size={14} />} label="Open in git.hanzo.ai" url={git} />
            <LinkButton icon={<Github size={14} />} label="View on GitHub" url={gh} />
          </XStack>

          {/* Hand to agent — only for non-PR work items. */}
          {issue.kind !== 'pr' ? (
            handedToAgent ? (
              <XStack items="center" gap="$2" px="$2.5" py="$2" rounded="$3" bg="$color2">
                <Bot size={14} />
                <Text fontSize="$2" color="$color11" flex={1}>
                  Handed to the coding agent. A linked PR appears here when the run opens one.
                </Text>
              </XStack>
            ) : (
              <Button icon={<Bot size={15} />} disabled={busy} onPress={() => void handToAgent()}>
                Hand to coding agent
              </Button>
            )
          ) : null}

          {/* Linked PRs */}
          {prs.length > 0 ? (
            <YStack gap="$1">
              <XStack items="center" gap="$1.5">
                <GitPullRequest size={13} />
                <Text fontSize="$2" color="$color10" fontWeight="600">
                  Linked pull requests · {prs.length}
                </Text>
              </XStack>
              {prs.map((pr) => (
                <LinkRow key={pr.id} issue={pr} onOpen={onOpenIssue} />
              ))}
            </YStack>
          ) : null}

          {/* Epic children */}
          {issue.kind === 'epic' ? (
            <YStack gap="$1">
              <XStack items="center" gap="$1.5">
                <Layers size={13} />
                <Text fontSize="$2" color="$color10" fontWeight="600">
                  Child issues · {children.length}
                </Text>
              </XStack>
              {children.length === 0 ? (
                <Text fontSize="$1" color="$color9" px="$2">
                  No children yet. Set a child issue&apos;s ExtRef to {issue.identifier} to link it here.
                </Text>
              ) : (
                children.map((c) => <LinkRow key={c.id} issue={c} onOpen={onOpenIssue} />)
              )}
            </YStack>
          ) : null}
        </Card>
      ) : null}
    </YStack>
  )
}
