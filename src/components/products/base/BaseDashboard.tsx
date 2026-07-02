'use client'

/**
 * Base — the Supabase-style dashboard for a Hanzo Base (hanzoai/base) backend.
 * ONE surface to model your content and see your data: list your content types
 * (collections), BUILD a new one (name + typed fields incl. File/Media and
 * Relation), then click into any type to browse and edit its records.
 *
 * Everything is the org's REAL Base over console2's OWN `/superbase` proxy — the
 * proxy mints the user's IAM bearer and stamps `X-Org-Id` from the JWT owner, so
 * every read/write is scoped to THIS org's Base (per-org SQLite). No token
 * reaches the browser. The record browse/edit is the SAME schema-driven
 * @hanzo/data surface `Records` uses (`CollectionTable` / `RecordDetailView`) —
 * one Base binding, not a reimplementation; this dashboard adds the builder.
 *
 * Routes (segment count is unambiguous, like Models' `:tab`):
 *   /base                     — content types (+ New content type)
 *   /base/new                 — the content-type builder
 *   /base/:collection         — that type's records (browse + New record)
 *   /base/:collection/:id      — one record (view/edit; `:id === 'new'` = create)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronRight, Database, Plus, Table } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { CollectionTable } from '~/components/base-data/CollectionTable'
import { RecordDetailView } from '~/components/base-data/RecordDetailView'
import { BaseDataApi } from '~/lib/base-data/api'
import { baseCollectionToFields, type BaseCollection } from '~/lib/base-data/fields'
import { CollectionBuilder } from './CollectionBuilder'

/** Product base path — must match the registry entry id (`base`). */
const BASE_PATH = '/base'
/** Same-origin Base proxy prefix (the proxy injects the user bearer server-side). */
const BASE_PROXY = '/superbase'

export function BaseDashboard({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const pathname = usePathname()
  const api = useMemo(() => new BaseDataApi({ baseUrl: BASE_PROXY }), [])
  const collection = params.collection
  const recordId = params.id
  const isNew = !collection && (pathname?.endsWith('/new') ?? false)

  const nav = useMemo(
    () => ({
      toIndex: () => router.push(BASE_PATH),
      toNew: () => router.push(`${BASE_PATH}/new`),
      toList: (c: string) => router.push(`${BASE_PATH}/${encodeURIComponent(c)}`),
      toNewRecord: (c: string) => router.push(`${BASE_PATH}/${encodeURIComponent(c)}/new`),
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

  // One content type's records.
  if (collection) {
    return (
      <YStack gap="$4">
        <PageHeader
          title={collection}
          subtitle="Records in this content type — click a row to view or edit."
          actions={
            <Button size="$3" onPress={nav.toIndex}>
              All content types
            </Button>
          }
        />
        <CollectionTable
          baseUrl={BASE_PROXY}
          collection={collection}
          onRowPress={(r) => {
            const id = (r as { id?: string }).id
            if (id) nav.toRecord(collection, id)
          }}
          action={
            <PrimaryButton size="$2" icon={<Plus size={15} />} onPress={() => nav.toNewRecord(collection)}>
              New record
            </PrimaryButton>
          }
        />
      </YStack>
    )
  }

  // The content-type builder.
  if (isNew) {
    return <BuilderLoader api={api} onCreated={(name) => nav.toList(name)} onCancel={nav.toIndex} />
  }

  // The content-types index.
  return <ContentTypesIndex api={api} onOpen={nav.toList} onNew={nav.toNew} />
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; collections: BaseCollection[] }

/** Fetch the org's collections, then render the builder (relation targets need them). */
function BuilderLoader({ api, onCreated, onCancel }: { api: BaseDataApi; onCreated: (n: string) => void; onCancel: () => void }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    api
      .listCollections()
      .then((all) => {
        if (!cancelled) setState({ phase: 'ready', collections: all.filter((c) => !c.system) })
      })
      .catch((e) => {
        // The builder can still work without existing collections (no relations yet).
        if (!cancelled) setState({ phase: 'ready', collections: [] })
        void classifyBackend(e)
      })
    return () => {
      cancelled = true
    }
  }, [api])

  if (state.phase === 'loading') {
    return (
      <XStack p="$4" gap="$2" items="center">
        <Spinner />
        <Text color="$color11">Loading…</Text>
      </XStack>
    )
  }
  const existing = state.phase === 'ready' ? state.collections : []
  return <CollectionBuilder api={api} existing={existing} onCreated={onCreated} onCancel={onCancel} />
}

/** The content-types picker — the org's real, non-system collections + "New". */
function ContentTypesIndex({ api, onOpen, onNew }: { api: BaseDataApi; onOpen: (name: string) => void; onNew: () => void }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

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
        subtitle="Model your content and manage your data — a Supabase-style backend on Hanzo Base, per organization."
        actions={
          <XStack gap="$2">
            <Button size="$3" onPress={reload}>
              Refresh
            </Button>
            <PrimaryButton size="$3" icon={<Plus size={16} />} onPress={onNew}>
              New content type
            </PrimaryButton>
          </XStack>
        }
      />
      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={reload} hint="base · GET /v1/collections" />
      ) : state.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Loading content types…</Text>
        </XStack>
      ) : state.collections.length === 0 ? (
        <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" p="$5" gap="$3" items="flex-start" maxW={620}>
          <XStack gap="$2" items="center">
            <Database size={18} />
            <Text fontSize="$5" fontWeight="700">No content types yet</Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            Create your first content type — a collection with typed fields (text, number, select, file/media,
            relations, and more). It persists to your organization's Base; nothing here is fabricated.
          </Text>
          <PrimaryButton size="$3" icon={<Plus size={16} />} onPress={onNew}>
            New content type
          </PrimaryButton>
        </YStack>
      ) : (
        <YStack gap="$2" maxW={760}>
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
                    <Text fontSize="$4" fontWeight="700">{name}</Text>
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

export default BaseDashboard
