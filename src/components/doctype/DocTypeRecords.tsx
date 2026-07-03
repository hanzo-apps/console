'use client'

/**
 * DocTypeRecords — the Twenty-grade records surface for ONE framework DocType,
 * driven ENTIRELY by DocType metadata. It loads the schema (→ @hanzo/data
 * `FieldDefinition[]` via `docTypeToFields`), the documents, and each relation's
 * candidate records, then renders through @hanzo/data's `RecordsView` — the shared
 * table ⇆ board view with filter/sort/group, inline cell editing, and a detail
 * hand-off. Every field type shows the right Display/Input with ZERO per-doctype
 * code, so a CMS Page, an ERP Invoice, or a Helpdesk Ticket all render here.
 *
 * Persistence is REAL: an inline cell edit sends the FULL record (the engine
 * validates the whole document on update) via `savePayload`, and reflects the
 * server's row. States are honest — loading / empty / backend-error, never a
 * fabricated row.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'
import { RecordsView, type FieldDefinition, type SelectOption } from '@hanzo/data'

import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import type { FrameworkClient } from '~/lib/framework/client'
import type { DocType, FrameworkDoc } from '~/lib/framework/types'
import { docTypeToFields, toRecord, enrichLinks, savePayload, isMediaDoctype } from '~/lib/framework/fields'
import { loadLinkOptions, makeFieldOptions } from './data'
import { MediaGrid } from './MediaGrid'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; dt: DocType; fields: FieldDefinition[]; docs: FrameworkDoc[]; records: Record<string, unknown>[]; linkOptions: Record<string, SelectOption[]> }

export interface DocTypeRecordsProps {
  client: FrameworkClient
  /** DocType name to render. */
  doctype: string
  /** Open a document's detail (by document name). */
  onOpen: (name: string) => void
  /** Start creating a document. */
  onCreate: () => void
  title?: ReactNode
}

export function DocTypeRecords({ client, doctype, onOpen, onCreate, title }: DocTypeRecordsProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [mutationError, setMutationError] = useState<string | null>(null)

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      setState({ phase: 'loading' })
      try {
        const dt = await client.doctypes.get(doctype)
        const linkOptions = await loadLinkOptions(client, dt)
        const docs = await client.records.list(doctype, { limit: 200 })
        if (signal.cancelled) return
        const records = docs.map((d) => enrichLinks(toRecord(d, dt), dt, linkOptions))
        setState({ phase: 'ready', dt, fields: docTypeToFields(dt), docs, records, linkOptions })
      } catch (e) {
        if (!signal.cancelled) setState({ phase: 'error', error: classifyBackend(e) })
      }
    },
    [client, doctype],
  )

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => { signal.cancelled = true }
  }, [load])

  const reload = useCallback(() => void load({ cancelled: false }), [load])

  const fieldOptions = useMemo(
    () => (state.phase === 'ready' ? makeFieldOptions(state.linkOptions) : undefined),
    [state],
  )

  /** Persist ONE inline edit. The engine validates the whole document on update,
   *  so send the full record with the cell change merged in (never a partial body). */
  const onEditCommit = useCallback(
    async (record: Record<string, unknown>, field: FieldDefinition, value: unknown) => {
      if (state.phase !== 'ready') return
      const name = typeof record.name === 'string' ? record.name : ''
      if (!name) return
      setMutationError(null)
      try {
        const body = savePayload({ ...record, [field.name]: value }, state.dt)
        const saved = await client.records.update(doctype, name, body)
        const next = enrichLinks(toRecord(saved, state.dt), state.dt, state.linkOptions)
        setState((s) => (s.phase === 'ready' ? { ...s, records: s.records.map((r) => (r.name === name ? next : r)) } : s))
      } catch (e) {
        setMutationError(classifyBackend(e).message)
        throw e // let the board revert its optimistic move
      }
    },
    [client, doctype, state],
  )

  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} onRetry={reload} hint={`framework · GET /v1/framework/${doctype}`} />
  }

  const refresh = <Button size="$2" icon={<RefreshCw size={15} />} onPress={reload}>Refresh</Button>

  // A media/asset library (a required Attach) gets the gallery instead of the table.
  if (state.phase === 'ready' && isMediaDoctype(state.dt)) {
    return <MediaGrid dt={state.dt} docs={state.docs} onOpen={onOpen} onCreate={onCreate} toolbarExtra={refresh} />
  }

  const ready = state.phase === 'ready' ? state : undefined
  return (
    <RecordsView
      title={title}
      fields={ready?.fields ?? []}
      records={ready?.records ?? []}
      loading={state.phase === 'loading'}
      onOpen={(r) => onOpen(String((r as { name?: unknown }).name ?? (r as { id?: unknown }).id ?? ''))}
      onCreate={onCreate}
      createLabel="New record"
      onEditCommit={onEditCommit}
      fieldOptions={fieldOptions}
      toolbarExtra={refresh}
      empty={mutationError ?? `No records in ${doctype} yet.`}
    />
  )
}

export default DocTypeRecords
