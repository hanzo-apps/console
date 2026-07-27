'use client'

/**
 * GitHub repositories — the connected-org view behind the GitHub integration card.
 * Once the org installs the Hanzo GitHub App, this lists every repo the install
 * grants and lets the org import (mirror) them into git.hanzo.ai, one at a time or
 * all at once. Each row shows its live sync status: Not imported · Importing ·
 * Synced · Conflict (native diverged and was preserved — never overwritten).
 *
 * Every call is org-scoped SERVER-SIDE (the granted set + the import both ride the
 * org's own installation token). Import is a BACKGROUND job on the backend (202
 * queued), so after an import the row shows "Importing" and the list self-refreshes
 * to pick up the flip to "Synced"; a manual Refresh is always available.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, Github, RefreshCw, DownloadCloud, Lock } from '@hanzogui/lucide-icons-2'

import { ApiError, GitHubApi, type GitHubRepo } from '~/lib/api'
import { PageHeader } from '@hanzo/ui/product'
import { PrimaryButton } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { BackendStateCard, classifyRead, type BackendState } from '@hanzo/ui/product'
import { useToast } from '@hanzo/ui/product'
import { repoStatusLabel, pendingRepoNames } from '~/components/products/integrations/logic'

function RepoRow({
  r,
  importing,
  busy,
  onImport,
}: {
  r: GitHubRepo
  importing: boolean
  busy: boolean
  onImport: (r: GitHubRepo) => void
}) {
  const label = repoStatusLabel(r, importing)
  return (
    <XStack items="center" gap="$3" p="$3" borderWidth={1} borderColor="$borderColor" rounded="$3" bg="$color1" flexWrap="wrap">
      <XStack items="center" gap="$2" flex={1} minW={220}>
        <Text fontSize="$4" fontWeight="600" color="$color12" numberOfLines={1}>
          {r.fullName || r.name}
        </Text>
        {r.private ? <Lock size={13} color="$color10" /> : null}
      </XStack>
      <StatusTag status={label} />
      {r.imported ? (
        <Button size="$2" disabled={busy} onPress={() => onImport(r)} icon={<RefreshCw size={13} />}>
          Re-sync
        </Button>
      ) : (
        <PrimaryButton
          size="$2"
          disabled={busy || importing}
          onPress={() => onImport(r)}
          icon={importing ? undefined : <DownloadCloud size={13} />}
        >
          {importing ? <Spinner size="small" /> : 'Import'}
        </PrimaryButton>
      )}
    </XStack>
  )
}

export function GitHubReposView({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  const [busy, setBusy] = useState(false)
  /** Names of repos currently mid background-import (optimistic "Importing"). */
  const [importing, setImporting] = useState<Set<string>>(new Set())
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const load = useCallback(() => {
    setLoading(true)
    return GitHubApi.listRepos()
      .then((rs) => {
        setRepos(rs)
        setError(null)
        // Clear the optimistic "Importing" for any repo now imported.
        setImporting((cur) => {
          if (cur.size === 0) return cur
          const next = new Set(cur)
          for (const r of rs) if (r.imported) next.delete(r.name)
          return next
        })
      })
      .catch((e) => {
        setRepos([])
        setError(classifyRead(e))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const t = timers.current
    return () => t.forEach(clearTimeout)
  }, [load])

  // After an import is queued, the backend imports in the background; poll a few
  // times so the row flips from Importing → Synced without a manual refresh.
  const scheduleRefresh = useCallback(() => {
    ;[3000, 7000, 12000].forEach((ms) => {
      timers.current.push(setTimeout(() => load(), ms))
    })
  }, [load])

  const onImport = useCallback(
    async (r: GitHubRepo) => {
      setBusy(true)
      setImporting((cur) => new Set(cur).add(r.name))
      try {
        await GitHubApi.importRepos({ repos: [r.name] })
        toast.success(`Queued ${r.name}`, 'Importing into git.hanzo.ai…')
        scheduleRefresh()
      } catch (e) {
        setImporting((cur) => {
          const next = new Set(cur)
          next.delete(r.name)
          return next
        })
        toast.error(`Could not import ${r.name}`, e instanceof ApiError ? e.message : 'Please try again.')
      } finally {
        setBusy(false)
      }
    },
    [toast, scheduleRefresh],
  )

  const onImportAll = useCallback(async () => {
    const pending = pendingRepoNames(repos)
    if (pending.length === 0) return
    setBusy(true)
    setImporting((cur) => {
      const next = new Set(cur)
      for (const n of pending) next.add(n)
      return next
    })
    try {
      const res = await GitHubApi.importRepos({ all: true })
      toast.success(`Queued ${res.queued || pending.length} repositories`, 'Importing into git.hanzo.ai…')
      scheduleRefresh()
    } catch (e) {
      setImporting(new Set())
      toast.error('Could not import repositories', e instanceof ApiError ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }, [repos, toast, scheduleRefresh])

  const pendingCount = pendingRepoNames(repos).length

  const header = (
    <PageHeader
      title="GitHub repositories"
      subtitle="Import your GitHub repositories into git.hanzo.ai and keep them in sync"
      actions={
        <XStack gap="$2">
          <Button size="$3" chromeless icon={<ArrowLeft size={15} />} onPress={onBack} aria-label="Back to integrations">
            Back
          </Button>
          <Button size="$3" chromeless icon={<RefreshCw size={15} />} onPress={() => load()} aria-label="Refresh" />
          {pendingCount > 0 ? (
            <PrimaryButton size="$3" disabled={busy} onPress={onImportAll} icon={<DownloadCloud size={15} />}>
              Import all ({pendingCount})
            </PrimaryButton>
          ) : null}
        </XStack>
      }
    />
  )

  if (loading && repos.length === 0 && !error) {
    return (
      <YStack gap="$4">
        {header}
        <XStack p="$6" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      </YStack>
    )
  }

  if (error) {
    return (
      <YStack gap="$4">
        {header}
        <BackendStateCard state={error} onRetry={() => load()} hint="endpoint · GET /v1/integrations/github/repos" />
      </YStack>
    )
  }

  if (repos.length === 0) {
    return (
      <YStack gap="$4">
        {header}
        <EmptyState
          icon={Github}
          title="No repositories granted"
          description="The Hanzo GitHub App has access to no repositories yet. Grant it repositories on GitHub, then refresh."
        />
      </YStack>
    )
  }

  return (
    <YStack gap="$4">
      {header}
      <Card p="$3" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color1">
        {repos.map((r) => (
          <RepoRow key={r.name} r={r} importing={importing.has(r.name)} busy={busy} onImport={onImport} />
        ))}
      </Card>
    </YStack>
  )
}
