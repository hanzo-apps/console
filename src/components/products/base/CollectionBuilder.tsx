'use client'

/**
 * The Base content-type builder — a Supabase-style "new table / collection"
 * editor. Define a content type (name + typed fields, including File/Media and
 * Relation), then create it on the org's Base. The real POST goes through the
 * `/superbase` proxy (`POST /v1/collections`), which mints the user's IAM bearer
 * and stamps `X-Org-Id` from the JWT owner — so the collection persists to THIS
 * org's Base only. All field → Base mapping + validation lives in `logic.ts`
 * (pure, tested); this file is the thin shell.
 */
import { useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Database, Plus, Trash2 } from '@hanzogui/lucide-icons-2'

import type { BaseDataApi } from '~/lib/base-data/api'
import { ApiError } from '~/lib/api'
import type { BaseCollection } from '~/lib/base-data/fields'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { FieldRow, FieldText, FieldTextArea, FieldSwitch, FieldSelect } from '~/components/ui/Field'
import {
  FIELD_KINDS,
  kindSpec,
  newField,
  slugifyName,
  validateCollection,
  toCollectionPayload,
  type BuilderField,
  type FieldKind,
} from './logic'

const KIND_LABELS = FIELD_KINDS.map((k) => k.label)
const labelToKind = (label: string): FieldKind => (FIELD_KINDS.find((k) => k.label === label)?.kind ?? 'text')
const kindToLabel = (kind: FieldKind): string => kindSpec(kind).label

type Submit = { phase: 'idle' } | { phase: 'saving' } | { phase: 'error'; message: string }

export function CollectionBuilder({
  api,
  existing,
  onCreated,
  onCancel,
}: {
  api: BaseDataApi
  existing: BaseCollection[]
  onCreated: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [fields, setFields] = useState<BuilderField[]>(() => [{ ...newField('text'), name: 'title' }])
  const [submit, setSubmit] = useState<Submit>({ phase: 'idle' })
  const [showErrors, setShowErrors] = useState(false)

  // Relation targets: the org's existing collections (name → Base id).
  const targets = useMemo(
    () => existing.filter((c) => typeof c.name === 'string' && !c.system && c.name),
    [existing],
  )
  const targetNames = useMemo(() => targets.map((c) => c.name as string), [targets])
  const targetsByName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of targets) if (c.name && c.id) m[c.name] = c.id
    return m
  }, [targets])

  const existingNames = useMemo(
    () => new Set(existing.map((c) => (c.name ?? '').toLowerCase()).filter(Boolean)),
    [existing],
  )

  const validation = useMemo(() => validateCollection(name, fields), [name, fields])
  const nameTaken = name.trim() !== '' && existingNames.has(name.trim().toLowerCase())

  const patch = (key: string, next: Partial<BuilderField>) =>
    setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...next } : f)))
  const addField = () => setFields((fs) => [...fs, newField('text')])
  const removeField = (key: string) => setFields((fs) => fs.filter((f) => f.key !== key))

  const create = async () => {
    setShowErrors(true)
    if (!validation.ok || nameTaken) return
    setSubmit({ phase: 'saving' })
    try {
      await api.createCollection(toCollectionPayload(name, fields, targetsByName))
      onCreated(name.trim())
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0
      const base = e instanceof Error ? e.message : 'Could not create the content type.'
      const message =
        status === 401 || status === 403
          ? 'Creating content types requires an organization admin. Ask an org admin, or sign in with an admin account.'
          : base
      setSubmit({ phase: 'error', message })
    }
  }

  const disabled = submit.phase === 'saving'
  return (
    <YStack gap="$4" maxW={840}>
      <PageHeader
        title="New content type"
        subtitle="Define a collection and its fields — it persists to your organization's Base."
        actions={
          <XStack gap="$2">
            <Button size="$3" onPress={onCancel} disabled={disabled}>
              Cancel
            </Button>
            <PrimaryButton size="$3" icon={<Database size={16} />} onPress={create} disabled={disabled}>
              {submit.phase === 'saving' ? 'Creating…' : 'Create content type'}
            </PrimaryButton>
          </XStack>
        }
      />

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <FieldRow label="Name">
          <YStack gap="$1.5">
            <FieldText value={name} onChange={setName} disabled={disabled} placeholder="blog_posts" />
            {showErrors && validation.nameError ? (
              <Text fontSize="$2" color="$red10">{validation.nameError}</Text>
            ) : nameTaken ? (
              <Text fontSize="$2" color="$red10">A content type named “{name.trim()}” already exists.</Text>
            ) : name.trim() && slugifyName(name) !== name.trim() ? (
              <Text fontSize="$2" color="$color10">Tip: “{slugifyName(name)}” is a valid name.</Text>
            ) : (
              <Text fontSize="$2" color="$color10">lower_snake_case, starting with a letter.</Text>
            )}
          </YStack>
        </FieldRow>
      </Card>

      <YStack gap="$2">
        <XStack items="center" justify="space-between">
          <Text fontSize="$5" fontWeight="700">Fields</Text>
          <Button size="$2" icon={<Plus size={15} />} onPress={addField} disabled={disabled}>
            Add field
          </Button>
        </XStack>

        {fields.length === 0 ? (
          <Card p="$4" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$3" color="$color10">Add at least one field to define this content type.</Text>
          </Card>
        ) : (
          fields.map((f) => (
            <FieldEditor
              key={f.key}
              field={f}
              targetNames={targetNames}
              disabled={disabled}
              error={showErrors ? validation.fieldErrors[f.key] : undefined}
              canRemove={fields.length > 1}
              onChange={(next) => patch(f.key, next)}
              onRemove={() => removeField(f.key)}
            />
          ))
        )}
      </YStack>

      {submit.phase === 'error' ? (
        <Card p="$3.5" gap="$1" borderWidth={1} borderColor="$red7" bg="$red2" maxW={840}>
          <Text fontSize="$3" fontWeight="700" color="$red11">Couldn’t create the content type</Text>
          <Text fontSize="$2" color="$red11">{submit.message}</Text>
        </Card>
      ) : null}
    </YStack>
  )
}

/** One field row — name + kind + required, plus the type-specific options. */
function FieldEditor({
  field,
  targetNames,
  disabled,
  error,
  canRemove,
  onChange,
  onRemove,
}: {
  field: BuilderField
  targetNames: string[]
  disabled?: boolean
  error?: string
  canRemove: boolean
  onChange: (next: Partial<BuilderField>) => void
  onRemove: () => void
}) {
  const spec = kindSpec(field.kind)
  return (
    <Card p="$3.5" gap="$3" borderWidth={1} borderColor={error ? '$red7' : '$borderColor'}>
      <XStack gap="$3" flexWrap="wrap" items="flex-end">
        <YStack flex={2} minW={200} gap="$1.5">
          <Text fontSize="$2" color="$color10" fontWeight="600">Field name</Text>
          <FieldText value={field.name} onChange={(v) => onChange({ name: v })} disabled={disabled} placeholder="first_name" />
        </YStack>
        <YStack flex={1} minW={160} gap="$1.5">
          <Text fontSize="$2" color="$color10" fontWeight="600">Type</Text>
          <FieldSelect
            value={kindToLabel(field.kind)}
            options={KIND_LABELS}
            onChange={(label) => onChange({ kind: labelToKind(label), multi: false, values: '', relationTarget: '', mimeTypes: '' })}
            disabled={disabled}
          />
        </YStack>
        <XStack items="center" gap="$2" pb="$2">
          <FieldSwitch checked={field.required} onChange={(v) => onChange({ required: v })} disabled={disabled} />
          <Text fontSize="$2" color="$color11">Required</Text>
        </XStack>
        {canRemove ? (
          <Button size="$2" chromeless icon={<Trash2 size={15} />} onPress={onRemove} disabled={disabled} aria-label="Remove field" />
        ) : null}
      </XStack>

      <Text fontSize="$1" color="$color10">{spec.hint}</Text>

      {/* Type-specific options. */}
      {(spec.needsValues || spec.needsRelation || spec.isFile || spec.supportsMulti) ? (
        <YStack gap="$3" pt="$1" borderTopWidth={1} borderColor="$borderColor">
          {spec.supportsMulti ? (
            <XStack items="center" gap="$2" pt="$3">
              <FieldSwitch checked={field.multi} onChange={(v) => onChange({ multi: v })} disabled={disabled} />
              <Text fontSize="$2" color="$color11">Allow multiple</Text>
            </XStack>
          ) : null}

          {spec.needsValues ? (
            <FieldRow label="Options">
              <YStack gap="$1.5">
                <FieldTextArea value={field.values} onChange={(v) => onChange({ values: v })} disabled={disabled} rows={3} />
                <Text fontSize="$1" color="$color10">One option per line (or comma-separated).</Text>
              </YStack>
            </FieldRow>
          ) : null}

          {spec.needsRelation ? (
            <FieldRow label="Related to">
              {targetNames.length > 0 ? (
                <FieldSelect
                  value={field.relationTarget}
                  options={targetNames}
                  onChange={(v) => onChange({ relationTarget: v })}
                  disabled={disabled}
                />
              ) : (
                <Text fontSize="$2" color="$color10">Create another content type first to relate to it.</Text>
              )}
            </FieldRow>
          ) : null}

          {spec.isFile ? (
            <FieldRow label="Accepted types">
              <YStack gap="$1.5">
                <FieldText value={field.mimeTypes} onChange={(v) => onChange({ mimeTypes: v })} disabled={disabled} placeholder="image/png, image/jpeg, application/pdf" />
                <Text fontSize="$1" color="$color10">Comma-separated MIME types. Leave blank to accept any file.</Text>
              </YStack>
            </FieldRow>
          ) : null}
        </YStack>
      ) : null}

      {error ? <Text fontSize="$2" color="$red10">{error}</Text> : null}
    </Card>
  )
}
