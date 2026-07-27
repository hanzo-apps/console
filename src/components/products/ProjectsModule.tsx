'use client'

/**
 * Projects — the org's projects, the unit every resource (o11y, API keys,
 * datasets, deploys) is scoped under. List + create + delete, and "Use" makes a
 * project the active scope (the project + environment switcher in the top bar
 * then scopes every module to it).
 *
 * Honest by construction: rows are the real `get-projects` payload; when that
 * service isn't routed on this deployment the load surfaces an honest
 * not-available state (never a fabricated project), and create is disabled.
 */
import { useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Check, FolderGit2, Plus, Trash } from '@hanzogui/lucide-icons-2'
import { useAnalytics } from '@hanzo/event/react'
import { EVENTS } from '@hanzo/event'

import { ProjectApi, projectEnvironments, type Project } from '~/lib/api/projects'
import { useScope } from '~/lib/scope-context'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { FieldRow, FieldText, FieldTextArea } from '@hanzo/ui/product'
import { PrimaryButton } from '@hanzo/ui/product'
import { ErrorState, asApiError } from '~/components/ui/States'
import { useToast } from '@hanzo/ui/product'

const fmt = (iso?: string) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export function ProjectsModule(_props: { params: Record<string, string> }) {
  const { scope, projects, projectsError, loadingProjects, selectProject, refreshProjects } = useScope()
  const toast = useToast()
  const analytics = useAnalytics()

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => {
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
    setBusy(true)
    try {
      await ProjectApi.create({ name: n, description: description.trim() })
      analytics.capture(EVENTS.PROJECT_CREATED)
      toast.success('Project created', `“${n}” is ready.`)
      reset()
      await refreshProjects()
      selectProject(n) // scope straight into the new project
    } catch (e) {
      toast.error('Could not create project', asApiError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Project) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete project “${p.displayName || p.name}”?`)) return
    try {
      await ProjectApi.remove(p.name)
      toast.success('Project deleted', `“${p.name}” was removed.`)
      if (scope.project === p.name) selectProject(undefined) // fall back to org-level
      await refreshProjects()
    } catch (e) {
      toast.error('Could not delete project', asApiError(e).message)
    }
  }

  const columns: Column<Project>[] = [
    {
      key: 'name',
      header: 'Project',
      render: (p) => (
        <XStack items="center" gap="$2">
          <FolderGit2 size={15} opacity={0.7} />
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
            {p.displayName || p.name}
          </Text>
          {scope.project === p.name ? (
            <XStack items="center" gap="$1" px="$1.5" py={1} rounded="$10" bg="$green4">
              <Check size={11} />
              <Text fontSize={10} fontWeight="800" color="$green11">
                ACTIVE
              </Text>
            </XStack>
          ) : null}
        </XStack>
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
      key: 'envs',
      header: 'Environments',
      width: 170,
      render: (p) => {
        const all = projectEnvironments(p)
        const custom = all.length - 3
        return (
          <Text fontSize="$3" color="$color11">
            mainnet · testnet · devnet{custom > 0 ? ` +${custom}` : ''}
          </Text>
        )
      },
    },
    {
      key: 'created',
      header: 'Created',
      width: 130,
      render: (p) => (
        <Text fontSize="$3" color="$color11">
          {fmt(p.createdTime)}
        </Text>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 150,
      render: (p) => (
        <XStack gap="$2" justify="flex-end">
          <Button
            size="$2"
            disabled={scope.project === p.name}
            onPress={() => {
              selectProject(p.name)
              toast.info('Scope set', `Now scoped to “${p.name}”.`)
            }}
          >
            {scope.project === p.name ? 'In use' : 'Use'}
          </Button>
          <Button size="$2" chromeless icon={<Trash size={14} />} onPress={() => void remove(p)} aria-label="Delete" />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Projects organize resources under your org — o11y, API keys, datasets, and deploys are all scoped to the active project and environment."
        actions={
          !projectsError ? (
            <Button icon={<Plus size={16} />} onPress={() => setCreating((v) => !v)}>
              New project
            </Button>
          ) : undefined
        }
      />

      {creating && !projectsError ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" maxWidth={640}>
          <Text fontSize="$5" fontWeight="700">
            New project
          </Text>
          <FieldRow label="Name">
            <FieldText value={name} onChange={setName} placeholder="my-app" disabled={busy} />
          </FieldRow>
          <FieldRow label="Description">
            <FieldTextArea value={description} onChange={setDescription} rows={3} disabled={busy} />
          </FieldRow>
          <Text fontSize="$2" color="$color10">
            mainnet, testnet, and devnet environments are created automatically — add custom ones later.
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

      {projectsError ? (
        <ErrorState
          err={projectsError}
          onRetry={() => void refreshProjects()}
          copy={{
            notFound:
              'The projects service is not routed on this deployment yet. Resources stay at org level (no project scoping) until it is provisioned.',
          }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={projects}
          loading={loadingProjects}
          rowKey={(p) => p.name}
          empty="No projects yet. Create one to scope o11y, API keys, datasets, and deploys under it."
        />
      )}
    </>
  )
}
