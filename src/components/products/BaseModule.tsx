'use client'

/**
 * Base — the org's own realtime backend, usable BY CLICKING.
 *
 * An organization HAS a Base. Not a registry of Bases, not an instance to pick
 * from a list: one per org on the managed Base (base.hanzo.ai), reached through
 * the console's own `/v1/superbase` proxy, which scopes every read and write to
 * the caller's org. So this module is the whole product — browse the content
 * types, open one, read and edit its records — rendered from each collection's
 * own field schema through @hanzo/data (`DataTable` for the list, `RecordDetail`/
 * `RecordForm` for the record), so every field type shows the right Display/Input
 * with no per-type code.
 *
 * Three views by route (segment count is unambiguous, same as Models' `:tab`):
 *   `/base`                    — the content-type index (pick one to browse)
 *   `/base/:collection`        — that collection's records (DataTable + New)
 *   `/base/:collection/:id`    — one record (view/edit); `:id === 'new'` = create
 *
 * `/records` resolves here through `SLUG_ALIASES` — it was a second product over
 * this same data, back when a separate orchestrator deployment held a registry of
 * Base instances and "which Base" was a question. It is one Base now, so browsing
 * it is not a different product from having it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, ChevronRight, Table, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { CollectionView } from '~/components/base-data/CollectionView'
import { RecordDetailView } from '~/components/base-data/RecordDetailView'
import { BaseDataApi } from '~/lib/base-data/api'
import { baseCollectionToFields, type BaseCollection } from '~/lib/base-data/fields'
import { BackendStateCard, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

/** Product base path — must match the registry entry id (`base`). */
const BASE_PATH = '/base'
/**
 * The org's Base, same-origin.
 *
 * `/v1/superbase` is the console's own proxy to the managed Base. It resolves the
 * caller from the session cookie, mints a user-bound IAM token and stamps
 * `X-Org-Id` from that token's owner, so the door cannot be pointed at another
 * tenant's data. It re-roots the tail onto Base's own `v1/collections/*` contract,
 * so the collections API answers natively underneath it and nothing here rewrites
 * a path.
 */
const BASE_ROOT = '/v1/superbase'

export function BaseModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const api = useMemo(() => new BaseDataApi({ baseUrl: BASE_ROOT }), [])
  const collection = params.collection
  const recordId = params.id

  const nav = useMemo(
    () => ({
      toIndex: () => router.push(BASE_PATH),
      toList: (c: string) => router.push(`${BASE_PATH}/${encodeURIComponent(c)}`),
      toNew: (c: string) => router.push(`${BASE_PATH}/${encodeURIComponent(c)}/new`),
      toRecord: (c: string, id: string) =>
        router.push(`${BASE_PATH}/${encodeURIComponent(c)}/${encodeURIComponent(id)}`),
    }),
    [router],
  )

  // One record — view / edit / create.
  if (collection && recordId) {
    return (
      <RecordDetailView
        api={api}
        collection={collection}
        recordId={recordId}
        onBack={() => nav.toList(collection)}
        onView={(id) => nav.toRecord(collection, id)}
      />
    )
  }

  // One collection's records — the table ⇆ board view.
  if (collection) {
    return (
      <YStack gap="$3">
        <XStack items="center">
          <Button size="$2" icon={<ArrowLeft size={15} />} onPress={nav.toIndex}>
            All content types
          </Button>
        </XStack>
        <CollectionView
          api={api}
          collection={collection}
          title={collection}
          onOpen={(r) => {
            const id = (r as { id?: string }).id
            if (id) nav.toRecord(collection, id)
          }}
          onCreate={() => nav.toNew(collection)}
        />
      </YStack>
    )
  }

  return <CollectionsIndex api={api} onOpen={nav.toList} />
}

type IndexState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; collections: BaseCollection[] }

/** The content-type picker — the real, non-system collections in the org's Base. */
function CollectionsIndex({ api, onOpen }: { api: BaseDataApi; onOpen: (name: string) => void }) {
  const [state, setState] = useState<IndexState>({ phase: 'loading' })

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      setState({ phase: 'loading' })
      try {
        const all = await api.listCollections()
        const collections = all
          .filter((c) => typeof c.name === 'string' && !c.system)
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
        if (!signal.cancelled) setState({ phase: 'ready', collections })
      } catch (e) {
        if (!signal.cancelled) setState({ phase: 'error', error: classifyBackend(e) })
      }
    },
    [api],
  )

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => {
      signal.cancelled = true
    }
  }, [load])

  const reload = useCallback(() => void load({ cancelled: false }), [load])

  return (
    <YStack gap="$4">
      <PageHeader
        title="Base"
        subtitle="Your organization's realtime backend — browse and edit every record, from the collection's own schema."
        actions={
          <Button size="$3" onPress={reload}>
            Refresh
          </Button>
        }
      />
      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={reload} hint="base · GET /v1/superbase/collections" />
      ) : state.phase === 'loading' ? (
        <Text fontSize="$3" color="$color10">
          Loading content types…
        </Text>
      ) : state.collections.length === 0 ? (
        <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" p="$4" gap="$2" items="center" maxW={620}>
          <TriangleAlert size={16} />
          <Text fontSize="$3" color="$color11">
            No content types yet. Create one in your Base, or sign in with an account that can read them.
          </Text>
        </XStack>
      ) : (
        <YStack gap="$2" maxW={720}>
          {state.collections.map((c) => {
            const name = c.name as string
            const count = baseCollectionToFields(c).length
            return (
              <XStack
                key={name}
                items="center"
                justify="space-between"
                gap="$3"
                borderWidth={1}
                borderColor="$borderColor"
                rounded="$4"
                px="$4"
                py="$3"
                cursor="pointer"
                hoverStyle={{ bg: '$color3', borderColor: '$color7' }}
                onPress={() => onOpen(name)}
              >
                <XStack items="center" gap="$3" flex={1}>
                  <Table size={16} />
                  <YStack flex={1}>
                    <Text fontSize="$4" fontWeight="700">
                      {name}
                    </Text>
                    <Text fontSize="$2" color="$color10">
                      {count} {count === 1 ? 'field' : 'fields'}
                      {c.type && c.type !== 'base' ? ` · ${c.type}` : ''}
                    </Text>
                  </YStack>
                </XStack>
                <ChevronRight size={16} />
              </XStack>
            )
          })}
        </YStack>
      )}
    </YStack>
  )
}
