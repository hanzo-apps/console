'use client'

/**
 * RecordDetailView — view / edit / create / delete ONE Base record, metadata-driven.
 *
 * It loads the collection schema (→ @hanzo/data `FieldDefinition[]`) and the record,
 * then renders through @hanzo/data's `RecordDetail` (read) and `RecordForm` (edit) —
 * the same field routers the list uses — so every field type shows the right
 * Display/Input with zero per-type code here. Create (`recordId === 'new'`) opens
 * straight into the form over a blank draft. Persistence is the Base record CRUD
 * (`createRecord` / `updateRecord` / `deleteRecord`) through whatever transport the
 * `BaseDataApi` was given (the same `/superbase` proxy the list uses).
 *
 * States are honest, never fabricated: the shared backend-state card on a load
 * failure, a "collection not found" note, an inline save error, and a two-step
 * delete confirmation. No optimistic fakery — the view reflects what the server
 * actually returned.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, Pencil, Save, Trash2, TriangleAlert, X } from '@hanzogui/lucide-icons-2'
import { RecordDetail, RecordForm, type FieldDefinition } from '@hanzo/data'

import { BaseDataApi, type BaseRecord } from '~/lib/base-data/api'
import { baseCollectionToFields } from '~/lib/base-data/fields'
import { recordLabel, savePayload } from './records'
import { BackendStateCard, PrimaryButton, classifyBackend, type BackendState } from '@hanzo/ui/product'

export interface RecordDetailViewProps {
  /** A configured Base client (transport already wired — e.g. the `/superbase` proxy). */
  api: BaseDataApi
  /** Collection name the record belongs to. */
  collection: string
  /** Record id, or `'new'` to open the create form. */
  recordId: string
  /** Back to the collection's record list. */
  onBack: () => void
  /** Open a record's detail (after a create, to land on the new record). */
  onView: (id: string) => void
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; fields: FieldDefinition[]; record: BaseRecord | null }

export function RecordDetailView({ api, collection, recordId, onBack, onView }: RecordDetailViewProps) {
  const isNew = recordId === 'new'
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [editing, setEditing] = useState(isNew)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

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
        const record = isNew ? null : await api.getRecord(collection, recordId)
        if (signal.cancelled) return
        setState({ phase: 'ready', fields, record })
        setDraft(record ? { ...record } : {})
        setEditing(isNew)
        setSaveError(null)
        setConfirmingDelete(false)
      } catch (e) {
        if (!signal.cancelled) setState({ phase: 'error', error: classifyBackend(e) })
      }
    },
    [api, collection, recordId, isNew],
  )

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => {
      signal.cancelled = true
    }
  }, [load])

  const reload = useCallback(() => void load({ cancelled: false }), [load])

  const ready = state.phase === 'ready' ? state : undefined
  const fields = ready?.fields ?? []
  const record = ready?.record ?? null
  const title = isNew ? `New ${collection} record` : recordLabel(record ?? {}, fields)

  const onChange = useCallback((name: string, value: unknown) => {
    setDraft((d) => ({ ...d, [name]: value }))
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = savePayload(draft, fields)
      if (isNew) {
        const created = await api.createRecord(collection, payload)
        if (created.id) onView(created.id)
        else onBack()
        return
      }
      if (!record?.id) throw new Error('This record has no id to update.')
      const updated = await api.updateRecord(collection, record.id, payload)
      setState({ phase: 'ready', fields, record: updated })
      setDraft({ ...updated })
      setEditing(false)
    } catch (e) {
      setSaveError(classifyBackend(e).message)
    } finally {
      setSaving(false)
    }
  }, [api, collection, draft, fields, isNew, onBack, onView, record])

  const remove = useCallback(async () => {
    if (!record?.id) return
    setSaving(true)
    setSaveError(null)
    try {
      await api.deleteRecord(collection, record.id)
      onBack()
    } catch (e) {
      setSaveError(classifyBackend(e).message)
      setSaving(false)
      setConfirmingDelete(false)
    }
  }, [api, collection, onBack, record])

  const backButton = useMemo(
    () => (
      <Button size="$2" icon={<ArrowLeft size={15} />} onPress={onBack}>
        Back
      </Button>
    ),
    [onBack],
  )

  if (state.phase === 'error') {
    return (
      <YStack gap="$3">
        {backButton}
        <BackendStateCard
          state={state.error}
          onRetry={reload}
          hint={`base · ${collection}/${recordId}`}
        />
      </YStack>
    )
  }

  if (state.phase === 'missing') {
    return (
      <YStack gap="$3">
        {backButton}
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
      </YStack>
    )
  }

  return (
    <YStack gap="$3">
      <XStack items="center" justify="space-between" gap="$4">
        <XStack items="center" gap="$3" flex={1}>
          {backButton}
          <YStack flex={1}>
            <Text fontSize="$6" fontWeight="800" numberOfLines={1}>
              {title}
            </Text>
            <Text fontSize="$2" color="$color10">
              {collection}
            </Text>
          </YStack>
        </XStack>
        <XStack items="center" gap="$2">
          {editing ? (
            <>
              {!isNew ? (
                <Button size="$2" icon={<X size={15} />} onPress={() => { setDraft(record ? { ...record } : {}); setEditing(false); setSaveError(null) }} disabled={saving}>
                  Cancel
                </Button>
              ) : null}
              <PrimaryButton size="$2" icon={<Save size={15} />} onPress={save} disabled={saving}>
                {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
              </PrimaryButton>
            </>
          ) : (
            <>
              <Button size="$2" theme="red" icon={<Trash2 size={15} />} onPress={() => setConfirmingDelete(true)} disabled={saving}>
                Delete
              </Button>
              <PrimaryButton size="$2" icon={<Pencil size={15} />} onPress={() => setEditing(true)}>
                Edit
              </PrimaryButton>
            </>
          )}
        </XStack>
      </XStack>

      {confirmingDelete ? (
        <Card borderWidth={1} borderColor="$red7" bg="$red2" p="$3" gap="$2" maxWidth={620}>
          <Text fontSize="$3" fontWeight="700">
            Delete “{title}”? This cannot be undone.
          </Text>
          <XStack gap="$2">
            <Button size="$2" theme="red" onPress={remove} disabled={saving}>
              {saving ? 'Deleting…' : 'Confirm delete'}
            </Button>
            <Button size="$2" onPress={() => setConfirmingDelete(false)} disabled={saving}>
              Cancel
            </Button>
          </XStack>
        </Card>
      ) : null}

      {saveError ? (
        <Card borderWidth={1} borderColor="$red7" bg="$red2" p="$3" maxWidth={620}>
          <Text fontSize="$3" color="$red11">
            {saveError}
          </Text>
        </Card>
      ) : null}

      <Card borderWidth={1} borderColor="$borderColor" p="$4" maxWidth={720}>
        {editing ? (
          <RecordForm fields={fields} values={draft} onChange={onChange} />
        ) : record ? (
          <RecordDetail title={title} fields={fields} record={record} />
        ) : null}
      </Card>
    </YStack>
  )
}

