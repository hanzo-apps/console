'use client'

/**
 * Records — the metadata-driven CRM/CMS surface over a Hanzo Base instance. It
 * makes Base usable BY CLICKING: browse a collection, open a record, edit it, and
 * create new ones — all rendered from the collection's own field schema through
 * @hanzo/data (`DataTable` for the list, `RecordDetail`/`RecordForm` for the
 * record), so every field type shows the right Display/Input with no per-type code.
 *
 * Three views by route (segment count is unambiguous, same as Models' `:tab`):
 *   `/records`                    — the collection index (pick one to browse)
 *   `/records/:collection`        — that collection's records (DataTable + New)
 *   `/records/:collection/:id`    — one record (view/edit); `:id === 'new'` = create
 *
 * Transport is console2's OWN `/superbase/*` proxy with the session cookie: the
 * proxy mints + forwards the user's IAM bearer to base.hanzo.ai, and Base
 * authorizes each read/write per-user and per-collection. No token reaches the
 * browser; this file injects nothing but the transport + navigation. States are
 * honest everywhere (loading / empty / error), never fabricated rows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, ChevronRight, Table, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { CollectionView } from '~/components/base-data/CollectionView'
import { RecordDetailView } from '~/components/base-data/RecordDetailView'
import { BaseDataApi } from '~/lib/base-data/api'
import { baseCollectionToFields, type BaseCollection } from '~/lib/base-data/fields'

/** Product base path — must match the registry entry id (`records`). */
const RECORDS_PATH = '/records'
/** Same-origin Base proxy prefix (the proxy injects the user bearer server-side). */
// The org's Base is served natively, same-origin, by the ONE cloud binary's
// embedded engine at /v1/base (per-org, org resolved from the validated IAM
// principal — CLOUD_BASE_EMBED). No /superbase proxy, no orchestrator hop.
const BASE_PROXY = '/v1/base'

export function RecordsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const api = useMemo(() => new BaseDataApi({ baseUrl: BASE_PROXY }), [])
  const collection = params.collection
  const recordId = params.id

  const nav = useMemo(
    () => ({
      toIndex: () => router.push(RECORDS_PATH),
      toList: (c: string) => router.push(`${RECORDS_PATH}/${encodeURIComponent(c)}`),
      toNew: (c: string) => router.push(`${RECORDS_PATH}/${encodeURIComponent(c)}/new`),
      toRecord: (c: string, id: string) =>
        router.push(`${RECORDS_PATH}/${encodeURIComponent(c)}/${encodeURIComponent(id)}`),
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

  // One collection's records — the Twenty-grade table ⇆ board view.
  if (collection) {
    return (
      <YStack gap="$3">
        <XStack items="center">
          <Button size="$2" icon={<ArrowLeft size={15} />} onPress={nav.toIndex}>
            All collections
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

  // The collection index.
  return <CollectionsIndex api={api} onOpen={nav.toList} />
}

type IndexState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; collections: BaseCollection[] }

/** The collection picker — the real, non-system collections on this Base. */
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
        title="Records"
        subtitle="Browse and edit records in any Hanzo Base collection — a metadata-driven CRM/CMS."
        actions={
          <Button size="$3" onPress={reload}>
            Refresh
          </Button>
        }
      />
      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={reload} hint="base · GET /v1/collections" />
      ) : state.phase === 'loading' ? (
        <Text fontSize="$3" color="$color10">
          Loading collections…
        </Text>
      ) : state.collections.length === 0 ? (
        <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" p="$4" gap="$2" items="center" maxW={620}>
          <TriangleAlert size={16} />
          <Text fontSize="$3" color="$color11">
            No collections are visible on this Base. Create one in Base, or sign in with an account that can
            read them.
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

