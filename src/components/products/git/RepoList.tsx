'use client'

/**
 * Repositories face of the Code hub — the org's hosted repos over the REAL per-org
 * `/v1/git` subsystem (`GitApi`, org-scoped SERVER-SIDE; no org param leaves the
 * browser). Every row is a REAL repo the backend returned; a field a repo omits (a fresh
 * bare repo has no HEAD/branches) reads "—". A free-text FILTER (a literal, ReDoS-safe
 * substring — never a compiled RegExp of user input) narrows the list, and repos are
 * GROUPED by org (a header shows only when more than one org is present, so it never adds
 * noise for the common single-org scope). "Last synced" is the repo's `updatedAt`, which
 * the native git host advances every time a mirror fast-forwards it — the honest freshness
 * signal (there is no separate sync-time field). Row press opens the repo browser
 * (`/code/repos/:name`). Honest states throughout: loading skeleton, a true "push your
 * first repo" empty state, a "no matches" filter state, and the shared BackendStateCard —
 * never a fabricated repo. This is the hub's front door to "all our code in one place".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Text, XStack, YStack } from '@hanzo/gui'
import { FolderGit2, GitBranch, RefreshCw, Search } from '@hanzogui/lucide-icons-2'

import { GitApi, cloneCommand, repoKey, type Repo } from '~/lib/api/git'
import { fmtBytes, fmtRelative } from '~/lib/api/agents'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { CopyButton } from './parts'
import { filterRepos, groupReposByOrg, repoHref } from '../code/hub-logic'

const EM = '—'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

export function RepoList() {
  const router = useRouter()
  const [state, setState] = useState<Async<Repo[]>>({ phase: 'loading' })
  const [query, setQuery] = useState('')

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
        header: 'Last synced',
        width: 120,
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

  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/git/repos" />
  }

  const all = state.phase === 'ready' ? state.data : []

  // A truly empty org (no repos at all) → the onboarding empty state.
  if (state.phase === 'ready' && all.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No repositories yet"
        description="Push your first repository to Hanzo Git, or connect GitHub to mirror your org’s repos here. Every repo shows up in this hub, per organization."
        bullets={[
          'Create a repo: POST /v1/git/repos { "name": "my-repo" }',
          'Add the remote: git remote add hanzo https://git.hanzo.ai/<org>/my-repo.git',
          'Push: git push hanzo main — then browse it right here.',
        ]}
      />
    )
  }

  const repos = filterRepos(all, query)
  const groups = groupReposByOrg(repos)
  const multiOrg = groups.length > 1

  return (
    <YStack gap="$3">
      {/* Filter + count + refresh. */}
      <XStack gap="$2" items="center" flexWrap="wrap">
        <XStack items="center" gap="$2" flex={1} minW={220} px="$3" borderWidth={1} borderColor="$borderColor" rounded="$3">
          <Search size={15} color="$color10" />
          <Input
            flex={1}
            unstyled
            value={query}
            onChangeText={setQuery}
            placeholder="Filter repositories…"
            autoCapitalize="none"
            py="$2"
          />
        </XStack>
        <Text fontSize="$2" color="$color10">
          {repos.length} of {all.length}
        </Text>
        <Button size="$3" icon={<RefreshCw size={15} />} aria-label="Refresh" onPress={load} />
      </XStack>

      {state.phase === 'ready' && repos.length === 0 ? (
        <YStack items="center" gap="$1" py="$6">
          <Text fontSize="$3" color="$color11" fontWeight="600">
            No repositories match “{query}”
          </Text>
          <Button size="$2" chromeless onPress={() => setQuery('')}>
            <Text fontSize="$2" color="$color11">
              Clear filter
            </Text>
          </Button>
        </YStack>
      ) : (
        groups.map((g) => (
          <YStack key={g.org} gap="$2">
            {multiOrg ? (
              <XStack items="center" gap="$2" pt="$1">
                <FolderGit2 size={14} color="$color10" />
                <Text fontSize="$2" fontWeight="700" color="$color11">
                  {g.org}
                </Text>
                <Text fontSize="$1" color="$color9">
                  {g.repos.length}
                </Text>
              </XStack>
            ) : null}
            <DataTable
              columns={columns}
              rows={g.repos}
              loading={state.phase === 'loading'}
              rowKey={repoKey}
              onRowPress={(r) => router.push(repoHref(r.name))}
              empty="No repositories yet."
            />
          </YStack>
        ))
      )}
    </YStack>
  )
}
