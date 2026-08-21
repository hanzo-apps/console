'use client'

/**
 * CollectionView — the Twenty-grade records surface for ONE Hanzo Base collection.
 *
 * It loads the collection schema (→ @hanzo/data `FieldDefinition[]` via
 * `baseCollectionToFields`) and the records, then renders them through @hanzo/data's
 * `RecordsView` — the shared table ⇆ board view with filter / sort / group, inline
 * cell editing, row selection, and a detail hand-off. Every field type shows the
 * right Display/Input with zero per-type code here, so a new Base field just works.
 *
 * Persistence is REAL and honest: an inline cell edit or a board card move calls
 * `BaseDataApi.updateRecord` and reflects the server's response (no optimistic
 * fakery beyond the board's follow-the-pointer, which reverts on failure); a failed
 * mutation surfaces an inline banner. Load failures use the shared backend-state
 * card; empty + loading are the view's own honest states. No demo rows, ever.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, TriangleAlert } from '@hanzogui/lucide-icons-2'
import { RecordsView, type FieldDefinition } from '@hanzo/data'

import { BaseDataApi, type BaseRecord } from '~/lib/base-data/api'
import { baseCollectionToFields } from '~/lib/base-data/fields'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; fields: FieldDefinition[]; records: BaseRecord[] }

export interface CollectionViewProps {
  /** A configured Base client (transport already wired — e.g. the `/superbase` proxy). */
  api: BaseDataApi
  /** Collection name (or id) to render. */
  collection: string
  /** Open a record's detail. */
  onOpen: (record: Record<string, unknown>) => void
  /** Start creating a record (the host routes to the create form). */
  onCreate: () => void
  /** Optional title above the view. */
  title?: ReactNode
}

export function CollectionView({ api, collection, onOpen, onCreate, title }: CollectionViewProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [mutationError, setMutationError] = useState<string | null>(null)

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      setState({ phase: 'loading' })
      try {
        const schema = await api.getCollection(collection)
        if (!schema) {
          if (!signal.cancelled) setState({ phase: 'missing' })
          return
        }
        const fields = baseCollectionToFields(schema)
        const { items } = await api.listRecords(collection, { perPage: 200 })
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
    return () => { signal.cancelled = true }
  }, [load])

  const reload = useCallback(() => void load({ cancelled: false }), [load])

  /** Persist one inline field edit (table cell or board move) and reflect the server row. */
  const onEditCommit = useCallback(
    async (record: Record<string, unknown>, field: FieldDefinition, value: unknown) => {
      const id = record.id != null ? String(record.id) : ''
      if (!id) return
      setMutationError(null)
      try {
        const updated = await api.updateRecord(collection, id, { [field.name]: value })
        setState((s) => (s.phase === 'ready' ? { ...s, records: s.records.map((r) => (String(r.id) === id ? updated : r)) } : s))
      } catch (e) {
        setMutationError(classifyBackend(e).message)
        throw e // let the board revert its optimistic move
      }
    },
    [api, collection],
  )

  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} onRetry={reload} hint={`base · GET /v1/superbase/collections/${collection}/records`} />
  }

  if (state.phase === 'missing') {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxW={620}>
        <XStack gap="$2" items="center">
          <TriangleAlert size={16} />
          <Text fontSize="$4" fontWeight="700">Collection not found</Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          No collection named “{collection}” is visible on this Base. Check the name, or sign in with an account that can read it.
        </Text>
      </Card>
    )
  }

  const ready = state.phase === 'ready' ? state : undefined
  return (
    <YStack gap="$3">
      {mutationError ? (
        <Card borderWidth={1} borderColor="$red7" bg="$red2" p="$3" maxW={720}>
          <Text fontSize="$3" color="$red11">{mutationError}</Text>
        </Card>
      ) : null}
      <RecordsView
        title={title}
        fields={ready?.fields ?? []}
        records={ready?.records ?? []}
        loading={state.phase === 'loading'}
        onOpen={onOpen}
        onCreate={onCreate}
        createLabel="New record"
        onEditCommit={onEditCommit}
        toolbarExtra={<Button size="$2" icon={<RefreshCw size={15} />} onPress={reload}>Refresh</Button>}
        empty={`No records in ${collection} yet.`}
      />
    </YStack>
  )
}

