'use client'

/**
 * Publishing face of the Code hub — where each repo's code actually reaches.
 *
 * A repo on the native git host publishes by holding outbound mirror targets: when a
 * push lands, the advanced branch is force-pushed to each target. So "is this repo
 * publishing?" is answered by its target list, and a repo with NO targets publishes
 * NOWHERE — a fact that, until this page, was visible only by asking the API repo by
 * repo, and so was not visible at all.
 *
 * Reads the REAL per-org `/v1/git` subsystem (`GitApi.repos` then `GitApi.mirrors` per
 * repo, org-scoped SERVER-SIDE — no org param leaves the browser and no viewer sees an
 * org they could not already list). The per-repo reads are concurrency-capped and each
 * is caught INDIVIDUALLY: a repo whose target list could not be read is marked unknown,
 * never silently counted as publishing nowhere. Confusing those two would turn a broken
 * read into a false accusation, which is the failure this page exists to remove.
 *
 * Silent repos sort first. Row press opens the repo browser (`/code/repos/:name`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { GitBranch, RefreshCw, Upload } from '@hanzogui/lucide-icons-2'

import { GitApi, type Mirror, type Repo } from '~/lib/api/git'
import { mapLimit } from '~/lib/map-limit'
import { fmtRelative } from '~/lib/api/agents'
import { byReach, hostsOf, reachOf, repoHref, tally, type Publication, type Reach } from './hub-logic'
import {
  BackendStateCard,
  DataTable,
  EmptyState,
  StatusTag,
  classifyBackend,
  type BackendState,
  type Column,
  type Tone,
} from '@hanzo/ui/product'

const EM = '—'

/** At most this many per-repo target reads in flight (see `mapLimit`). */
const IN_FLIGHT = 6

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

/**
 * The pill for a reach, in the product tone vocabulary (a grey ladder — no colour to
 * spend). `nowhere` takes `stopped`, the register for "will not proceed without you",
 * which is exactly what a repo with no target is; `unknown` takes `quiet` because a
 * read we could not make has nothing to report about the repo itself.
 */
const REACH_TAG: Record<Reach, { status: string; tone: Tone }> = {
  published: { status: 'Publishing', tone: 'settled' },
  nowhere: { status: 'Nowhere', tone: 'stopped' },
  unknown: { status: 'Unreadable', tone: 'quiet' },
}

/**
 * Read every repo, then each repo's targets. Per-repo failures degrade that ROW to
 * unknown; a failure to list repos at all is the page's error state, because then
 * there is nothing to report on.
 */
async function loadPublications(): Promise<Publication[]> {
  const repos: Repo[] = await GitApi.repos()
  const targets: (Mirror[] | 'unknown')[] = repos.map(() => 'unknown')
  await mapLimit(
    repos.map((_, i) => i),
    IN_FLIGHT,
    async (i) => {
      try {
        targets[i] = await GitApi.mirrors(repos[i].name)
      } catch {
        // Leave it `unknown`: we could not ask, which is not the same as "nowhere".
      }
    },
  )
  return repos.map((repo, i) => ({ repo, targets: targets[i] }))
}

/**
 * One summary count, and the filter it applies.
 *
 * The counts are the headline, so they are also the control: measured on the hanzo org,
 * 16 of 248 repos publish and 232 do not, and at that ratio an unfiltered list is a wall
 * you scroll rather than a question you answer. Pressing a count narrows to it; pressing
 * it again clears. `emphasis` is for the count that is a finding, which the caller
 * decides — nothing here treats "nowhere" as an error, because whether a given repo
 * SHOULD publish is not a fact this system records.
 */
function Count({
  n,
  label,
  active,
  emphasis,
  onPress,
}: {
  n: number
  label: string
  active: boolean
  emphasis?: boolean
  onPress: () => void
}) {
  return (
    <XStack
      px="$2"
      py="$1"
      rounded="$2"
      cursor="pointer"
      bg={active ? '$color4' : 'transparent'}
      hoverStyle={{ bg: '$color3' }}
      onPress={onPress}
      role="button"
      aria-pressed={active}
    >
      <Text fontSize="$2" fontWeight={emphasis || active ? '700' : '400'} color={emphasis || active ? '$color12' : '$color10'}>
        {n} {label}
      </Text>
    </XStack>
  )
}

export function PublishList() {
  const router = useRouter()
  const [state, setState] = useState<Async<Publication[]>>({ phase: 'loading' })
  const [only, setOnly] = useState<Reach | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    loadPublications()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(() => {
    if (state.phase !== 'ready') return []
    const ordered = byReach(state.data)
    return only ? ordered.filter((p) => reachOf(p) === only) : ordered
  }, [state, only])
  const counts = useMemo(
    () => (state.phase === 'ready' ? tally(state.data) : null),
    [state],
  )

  const columns: Column<Publication>[] = useMemo(
    () => [
      {
        key: 'repo',
        header: 'Repository',
        render: (p) => (
          <XStack items="center" gap="$2" minW={0}>
            <GitBranch size={15} color="$color10" />
            <YStack minW={0}>
              <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
                {p.repo.name}
              </Text>
              {p.repo.org ? (
                <Text fontSize="$1" color="$color10" numberOfLines={1}>
                  {p.repo.org}
                </Text>
              ) : null}
            </YStack>
          </XStack>
        ),
      },
      {
        key: 'reach',
        header: 'Publishes',
        width: 130,
        render: (p) => {
          const t = REACH_TAG[reachOf(p)]
          return <StatusTag status={t.status} tone={t.tone} />
        },
      },
      {
        key: 'targets',
        header: 'To',
        render: (p) => {
          const hosts = hostsOf(p)
          if (hosts.length) {
            return (
              <Text fontSize="$3" color="$color11" numberOfLines={1}>
                {hosts.join(', ')}
              </Text>
            )
          }
          return (
            <Text fontSize="$3" color="$color10" numberOfLines={1}>
              {reachOf(p) === 'nowhere' ? 'No target configured' : EM}
            </Text>
          )
        },
      },
      {
        key: 'updatedAt',
        header: 'Last push',
        width: 150,
        render: (p) => (
          <Text fontSize="$3" color="$color11">
            {p.repo.updatedAt ? fmtRelative(p.repo.updatedAt) : EM}
          </Text>
        ),
      },
    ],
    [],
  )

  return (
    <YStack gap="$3">
      {/* Summary + refresh — the counts are the headline, so they lead. */}
      <XStack gap="$3" items="center" flexWrap="wrap">
        {counts ? (
          <>
            <Count
              n={counts.total}
              label={counts.total === 1 ? 'repository' : 'repositories'}
              active={only === null}
              onPress={() => setOnly(null)}
            />
            <Count
              n={counts.published}
              label="publishing"
              active={only === 'published'}
              onPress={() => setOnly(only === 'published' ? null : 'published')}
            />
            <Count
              n={counts.nowhere}
              label="nowhere"
              active={only === 'nowhere'}
              onPress={() => setOnly(only === 'nowhere' ? null : 'nowhere')}
            />
            {counts.unknown ? (
              <Count
                n={counts.unknown}
                label="unreadable"
                emphasis
                active={only === 'unknown'}
                onPress={() => setOnly(only === 'unknown' ? null : 'unknown')}
              />
            ) : null}
          </>
        ) : null}
        <XStack flex={1} minW={0} />
        <Button size="$3" icon={<RefreshCw size={15} />} aria-label="Refresh" onPress={() => load()} />
      </XStack>

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={() => load()} />
      ) : state.phase === 'ready' && !state.data.length ? (
        <EmptyState
          icon={Upload}
          title="No repositories yet"
          description="Push a repository to the native git host and where it publishes appears here."
          bullets={[
            'Add a target: POST /v1/git/repos/<repo>/mirrors { "url": "https://github.com/<org>/<repo>.git" }',
            'Every later push force-pushes the branch that advanced to each target.',
          ]}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={state.phase === 'loading'}
          rowKey={(p) => p.repo.id}
          onRowPress={(p) => router.push(repoHref(p.repo.name))}
          empty="No repositories yet."
        />
      )}
    </YStack>
  )
}
