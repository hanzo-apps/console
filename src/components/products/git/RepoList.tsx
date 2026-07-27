'use client'

/**
 * Repos list — the org's hosted Git repositories (name · description · default branch ·
 * size · last-updated · clone). Every row is a REAL repo returned by the backend; a
 * field a repo omits (an empty repo has no HEAD/branches) reads "—". Row press opens the
 * repo browser (`/git/:name`). Honest states: loading skeleton, a true "push your first
 * repo" empty state, and the shared BackendStateCard on 401/403/404/503 — never a
 * fabricated repo.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { GitBranch, RefreshCw } from '@hanzogui/lucide-icons-2'

import { GitApi, cloneCommand, repoKey, type Repo } from '~/lib/api/git'
import { fmtBytes, fmtRelative } from '~/lib/api/agents'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { CopyButton } from './parts'

const EM = '—'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

export function RepoList() {
  const router = useRouter()
  const [state, setState] = useState<Async<Repo[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    GitApi.repos()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const columns: Column<Repo>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Repository',
        render: (r) => (
          <XStack items="center" gap="$2" minW={0}>
            <GitBranch size={15} color="$color10" />
            <YStack minW={0}>
              <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
                {r.name}
              </Text>
              {r.description ? (
                <Text fontSize="$1" color="$color10" numberOfLines={1}>
                  {r.description}
                </Text>
              ) : null}
            </YStack>
          </XStack>
        ),
      },
      {
        key: 'defaultBranch',
        header: 'Default branch',
        width: 140,
        render: (r) => (
          <XStack items="center" gap="$1.5">
            <GitBranch size={12} color="$color9" />
            <Text className="hz-mono" fontSize="$2" color="$color11" numberOfLines={1}>
              {r.defaultBranch || EM}
            </Text>
          </XStack>
        ),
      },
      {
        key: 'sizeBytes',
        header: 'Size',
        width: 90,
        align: 'right',
        render: (r) => (
          <Text fontSize="$3" color="$color10" className="hz-mono">
            {fmtBytes(r.sizeBytes)}
          </Text>
        ),
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        width: 110,
        align: 'right',
        render: (r) => (
          <Text fontSize="$2" color="$color10">
            {fmtRelative(r.updatedAt ?? r.createdAt)}
          </Text>
        ),
      },
      {
        key: 'clone',
        header: 'Clone',
        width: 120,
        // Copy the ready-to-run `git clone <url>`; stopPropagation so the copy doesn't
        // also open the row's browser.
        render: (r) => (
          <XStack onPress={(e) => e.stopPropagation()}>
            <CopyButton value={cloneCommand(r)} label="Clone URL" ariaLabel={`Copy git clone command for ${r.name}`} />
          </XStack>
        ),
      },
    ],
    [],
  )

  const header = (
    <PageHeader
      title="Git"
      subtitle="Your organization’s hosted Git repositories — browse code, commits, and branches, and clone or push over native git."
      actions={<Button size="$3" icon={<RefreshCw size={15} />} aria-label="Refresh" onPress={load} />}
    />
  )

  if (state.phase === 'error') {
    return (
      <YStack gap="$4">
        {header}
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/git/repos" />
      </YStack>
    )
  }

  const repos = state.phase === 'ready' ? state.data : []

  if (state.phase === 'ready' && repos.length === 0) {
    return (
      <YStack gap="$4">
        {header}
        <EmptyState
          icon={GitBranch}
          title="No repositories yet"
          description="Push your first repository to Hanzo Git. Create a repo with the API or CLI, add it as a remote, and push — it shows up here, per organization."
          bullets={[
            'Create a repo: POST /v1/git/repos { "name": "my-repo" }',
            'Add the remote: git remote add hanzo https://git.hanzo.ai/<org>/my-repo.git',
            'Push: git push hanzo main — then browse it right here.',
          ]}
        />
      </YStack>
    )
  }

  return (
    <YStack gap="$4">
      {header}
      <DataTable
        columns={columns}
        rows={repos}
        loading={state.phase === 'loading'}
        rowKey={repoKey}
        onRowPress={(r) => router.push(`/git/${encodeURIComponent(r.name)}`)}
        empty="No repositories yet."
      />
    </YStack>
  )
}
