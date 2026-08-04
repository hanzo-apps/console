'use client'

/**
 * Commits view — the ref's history (or a single file's history when `path` is set):
 * message · author · short sha (copyable) · relative date, the gitea commits list.
 * Honest states: loading, BackendStateCard on failure, and a real "no commits" empty
 * (a fresh bare repo). Never fabricated commits.
 */
import { useCallback, useEffect, useState } from 'react'
import { Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { GitCommit } from '@hanzogui/lucide-icons-2'

import { GitApi, type Commit } from '~/lib/api/git'
import { fmtRelative } from '~/lib/api/agents'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { CopyButton } from './parts'

type Load<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

/** First line of a commit message (the subject), the gitea list rendering. */
const subjectOf = (message: string): string => message.split('\n')[0] || message

export function CommitsView({ name, refName, path }: { name: string; refName: string; path?: string }) {
  const [state, setState] = useState<Load<Commit[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    GitApi.commits(name, { ref: refName, path, limit: 50 })
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [name, refName, path])
  useEffect(() => {
    load()
  }, [load])

  if (state.phase === 'loading') {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$5">
        <XStack justify="center">
          <Spinner size="small" color="$color11" />
        </XStack>
      </Card>
    )
  }
  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} onRetry={load} hint={`endpoint · GET /v1/git/repos/${name}/commits`} />
  }
  if (state.data.length === 0) {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$6">
        <YStack items="center" gap="$1">
          <GitCommit size={22} color="$color10" />
          <Text fontSize="$3" color="$color10">
            No commits on this branch yet.
          </Text>
        </YStack>
      </Card>
    )
  }

  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$0" overflow="hidden">
      {path ? (
        <XStack px="$3" py="$2" borderBottomWidth={1} borderColor="$borderColor" bg="$color2">
          <Text fontSize="$2" color="$color10">
            History of{' '}
            <Text className="mono" fontSize="$2" color="$color12">
              {path}
            </Text>
          </Text>
        </XStack>
      ) : null}
      {state.data.map((c, i) => (
        <XStack
          key={c.sha}
          items="center"
          gap="$3"
          px="$3"
          py="$2.5"
          borderTopWidth={i === 0 ? 0 : 1}
          borderColor="$borderColor"
        >
          <GitCommit size={16} color="$color9" />
          <YStack flex={1} minW={0} gap="$0.5">
            <Text fontSize="$3" color="$color12" numberOfLines={1}>
              {subjectOf(c.message) || '—'}
            </Text>
            <XStack items="center" gap="$2" flexWrap="wrap">
              {c.authorName ? (
                <Text fontSize="$1" color="$color10">
                  {c.authorName}
                </Text>
              ) : null}
              <Text fontSize="$1" color="$color9">
                {fmtRelative(c.date)}
              </Text>
            </XStack>
          </YStack>
          <XStack items="center" gap="$1">
            <Text className="mono" fontSize="$2" color="$color10">
              {c.shortSha}
            </Text>
            <CopyButton value={c.sha} label="" ariaLabel={`Copy commit ${c.shortSha}`} size="$1" />
          </XStack>
        </XStack>
      ))}
    </Card>
  )
}
