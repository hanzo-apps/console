'use client'

/**
 * CollectionTable — render the REAL records of one Hanzo Base collection.
 *
 * Given a Base `baseUrl` (a direct origin or a same-origin proxy) and a
 * collection `name`, it (1) loads the collection schema and maps it to
 * @hanzo/data `FieldDefinition[]` via `baseCollectionToFields`, then (2) loads the
 * records, and renders them through @hanzo/data's `DataTable` — the same typed
 * grid every Base-backed view uses, so a new field type needs zero changes here.
 *
 * States are honest, never fabricated: the shared backend-state card on a load
 * failure (401/403/404/503/network, classified the same as every other module),
 * a clear "collection not found" note when the name is absent, and the table's
 * own loading + empty states. No demo rows, ever.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, TriangleAlert } from '@hanzogui/lucide-icons-2'
import { DataTable, type FieldDefinition } from '@hanzo/data'

import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { BaseDataApi, type BaseRecord } from '~/lib/base-data/api'
import { baseCollectionToFields } from '~/lib/base-data/fields'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; fields: FieldDefinition[]; records: BaseRecord[] }

export interface CollectionTableProps {
  /** Base origin or same-origin proxy prefix (e.g. `/superbase`). */
  baseUrl: string
  /** Collection name (or id) to render. */
  collection: string
  /** Optional Base bearer token (omit when a proxy injects auth server-side). */
  token?: string
  /** Optional row click handler (the host opens a detail view). */
  onRowPress?: (record: Record<string, unknown>) => void
}

export function CollectionTable({ baseUrl, collection, token, onRowPress }: CollectionTableProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const api = useMemo(() => new BaseDataApi({ baseUrl, token }), [baseUrl, token])

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      setState({ phase: 'loading' })
      try {
        const collections = await api.listCollections()
        const schema = collections.find((c) => c.name === collection)
        if (!schema) {
          if (!signal.cancelled) setState({ phase: 'missing' })
          return
        }
        const fields = baseCollectionToFields(schema)
        const { items } = await api.listRecords(collection)
        if (!signal.cancelled) setState({ phase: 'ready', fields, records: items })
      } catch (e) {
        if (!signal.cancelled) setState({ phase: 'error', error: classifyBackend(e) })
      }
    },
    [api, collection],
  )

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => {
      signal.cancelled = true
    }
  }, [load])

  const reload = useCallback(() => void load({ cancelled: false }), [load])

  if (state.phase === 'error') {
    return (
      <BackendStateCard
        state={state.error}
        onRetry={reload}
        hint={`base · GET /v1/collections/${collection}/records`}
      />
    )
  }

  if (state.phase === 'missing') {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={620}>
        <XStack gap="$2" items="center">
          <TriangleAlert size={16} />
          <Text fontSize="$4" fontWeight="700">
            Collection not found
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          No collection named “{collection}” is visible on this Base. Check the name, or sign in with an
          account that can read it.
        </Text>
      </Card>
    )
  }

  const ready = state.phase === 'ready' ? state : undefined
  return (
    <YStack gap="$3">
      <XStack items="center" justify="space-between">
        <Text fontSize="$5" fontWeight="700">
          {collection}
        </Text>
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={reload}>
          Refresh
        </Button>
      </XStack>
      <DataTable
        fields={ready?.fields ?? []}
        records={ready?.records ?? []}
        loading={state.phase === 'loading'}
        onRowPress={onRowPress}
        empty={`No records in ${collection} yet.`}
      />
    </YStack>
  )
}

export default CollectionTable
