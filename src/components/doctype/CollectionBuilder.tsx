'use client'

/**
 * CollectionBuilder — the dynamic content-type builder: define a collection's
 * NAME and its typed FIELDS on-page (add / remove / reorder / require / show-in-
 * list), then create it as a framework DocType. This is the Payload "collection
 * config" authored in the UI: every framework fieldtype is offered (Text, Rich
 * text, Long text, Number, Decimal, Currency, Checkbox, Date, Date & time, Select,
 * Relation, Attachment, Table, JSON), with the extra inputs each type needs
 * (Select options, Relation target). Pure decisions live in `builder-logic.ts`.
 *
 * Used for BOTH "New collection" (create) and, on an existing collection, editing
 * its schema in Settings — the SAME builder over `client.doctypes.create/update`.
 */
import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { Button, Card, Input, Label, Text, XStack, YStack } from '@hanzo/gui'
import { GripVertical, Plus, Trash2, TriangleAlert, ArrowUp, ArrowDown } from '@hanzogui/lucide-icons-2'

import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { FieldSwitch } from '~/components/ui/Field'
import { classifyBackend } from '~/components/ui/BackendState'
import type { FrameworkClient } from '~/lib/framework/client'
import type { DocType, Fieldtype } from '~/lib/framework/types'
import {
  BUILDER_FIELD_TYPES,
  fieldNeedsOptions,
  fieldNameFromLabel,
  blankField,
  starterFields,
  validateBuilder,
  toDocType,
  type BuilderField,
} from './builder-logic'
import { CHEVRON } from '~/components/ui/Field'

// A value≠label native <select>, themed with the app CSS vars (same idiom as
// ui/Field.tsx FieldSelect, but here options carry a distinct value + label).
const selectStyle: CSSProperties = {
  boxSizing: 'border-box',
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  background: `var(--background) url("${CHEVRON}") no-repeat right 8px center`,
  color: 'var(--color12)',
  border: '1px solid var(--borderColor)',
  borderRadius: 8,
  padding: '7px 28px 7px 10px',
  fontSize: 13,
  height: 34,
  outline: 'none',
  cursor: 'pointer',
  minWidth: 130,
}
const OPTION_STYLE: CSSProperties = { background: 'var(--color2)', color: 'var(--color12)' }

export interface CollectionBuilderProps {
  client: FrameworkClient
  module: string
  /** Editing an existing collection's schema (name locked), else creating a new one. */
  existing?: DocType
  /** Called with the saved collection's name after create/update. */
  onSaved: (name: string) => void
  onCancel: () => void
}

/** An existing DocType → editable builder rows (drops engine-managed fields). */
function fieldsFromDocType(dt: DocType): BuilderField[] {
  return (dt.fields ?? []).map((f) => ({
    key: `${f.fieldname}_${Math.random().toString(36).slice(2, 7)}`,
    label: f.label || f.fieldname,
    type: f.fieldtype,
    required: Boolean(f.reqd),
    inListView: Boolean(f.inListView),
    options: f.options ?? '',
  }))
}

export function CollectionBuilder({ client, module, existing, onSaved, onCancel }: CollectionBuilderProps) {
  const editing = Boolean(existing)
  const [name, setName] = useState(existing?.name ?? '')
  const [fields, setFields] = useState<BuilderField[]>(() =>
    existing ? fieldsFromDocType(existing) : starterFields(),
  )
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  const validation = useMemo(() => validateBuilder(name, fields), [name, fields])

  const patch = useCallback((key: string, next: Partial<BuilderField>) => {
    setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...next } : f)))
  }, [])
  const addField = useCallback(() => setFields((fs) => [...fs, blankField()]), [])
  const removeField = useCallback((key: string) => setFields((fs) => fs.filter((f) => f.key !== key)), [])
  const move = useCallback((key: string, dir: -1 | 1) => {
    setFields((fs) => {
      const i = fs.findIndex((f) => f.key === key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= fs.length) return fs
      const next = [...fs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])

  const save = useCallback(async () => {
    setShowErrors(true)
    if (!validation.ok) return
    setBusy(true)
    setSaveError(null)
    try {
      const dt = toDocType(name, module, fields)
      if (editing) await client.doctypes.update(name, dt)
      else await client.doctypes.create(dt)
      onSaved(name)
    } catch (e) {
      setSaveError(classifyBackend(e).message)
    } finally {
      setBusy(false)
    }
  }, [client, editing, fields, module, name, onSaved, validation.ok])

  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$4" maxWidth={820}>
      <YStack gap="$2">
        <Text fontSize="$5" fontWeight="800">{editing ? `Edit ${name}` : 'New collection'}</Text>
        <Text fontSize="$2" color="$color10">
          A content type on the Hanzo Framework — name it and define its fields. Every field type is available; a rich-text field gives a full WYSIWYG body.
        </Text>
      </YStack>

      {/* Name */}
      <XStack gap="$3" items="center" flexWrap="wrap">
        <Label width={110} color="$color11" fontSize="$3">Collection</Label>
        <Input
          flex={1}
          minW={220}
          placeholder="e.g. Recipe or LandingPage"
          value={name}
          onChangeText={setName}
          disabled={busy || editing}
          autoCapitalize="none"
        />
      </XStack>
      {editing ? (
        <Text fontSize="$1" color="$color9" style={{ marginTop: -8 }}>A collection’s name is its identity and can’t change.</Text>
      ) : null}

      {/* Fields */}
      <YStack gap="$2">
        <XStack items="center" justify="space-between">
          <Text fontSize="$3" fontWeight="700" color="$color11">Fields</Text>
          <Text fontSize="$1" color="$color9">{fields.length} field{fields.length === 1 ? '' : 's'}</Text>
        </XStack>

        <YStack gap="$2">
          {fields.map((f, i) => {
            const err = showErrors ? validation.fieldErrors[f.key] : undefined
            const fname = f.label.trim() ? fieldNameFromLabel(f.label) : ''
            return (
              <YStack
                key={f.key}
                borderWidth={1}
                borderColor={err ? '$red7' : '$borderColor'}
                rounded="$4"
                p="$3"
                gap="$2"
                bg="$color1"
              >
                <XStack gap="$2" items="center" flexWrap="wrap">
                  <GripVertical size={15} color="var(--color8)" />
                  <Input
                    flex={1}
                    minW={160}
                    size="$3"
                    placeholder="Field name (e.g. Title)"
                    value={f.label}
                    onChangeText={(v) => patch(f.key, { label: v })}
                    disabled={busy}
                    autoCapitalize="none"
                  />
                  <select
                    value={f.type}
                    onChange={(e) => patch(f.key, { type: e.currentTarget.value as Fieldtype })}
                    disabled={busy}
                    aria-label="Field type"
                    style={selectStyle}
                  >
                    {BUILDER_FIELD_TYPES.map((t) => (
                      <option key={t.type} value={t.type} style={OPTION_STYLE}>{t.label}</option>
                    ))}
                  </select>
                  <XStack gap="$3" items="center">
                    <XStack gap="$1" items="center">
                      <FieldSwitch checked={f.required} onChange={(v) => patch(f.key, { required: v })} disabled={busy} />
                      <Text fontSize="$1" color="$color10">Req</Text>
                    </XStack>
                    <XStack gap="$1" items="center">
                      <FieldSwitch checked={f.inListView} onChange={(v) => patch(f.key, { inListView: v })} disabled={busy} />
                      <Text fontSize="$1" color="$color10">List</Text>
                    </XStack>
                  </XStack>
                  <XStack gap="$1">
                    <Button size="$1" circular icon={<ArrowUp size={13} />} disabled={busy || i === 0} onPress={() => move(f.key, -1)} />
                    <Button size="$1" circular icon={<ArrowDown size={13} />} disabled={busy || i === fields.length - 1} onPress={() => move(f.key, 1)} />
                    <Button size="$1" circular theme="red" icon={<Trash2 size={13} />} disabled={busy} onPress={() => removeField(f.key)} />
                  </XStack>
                </XStack>

                {/* Per-type extra input: Select options / Relation target */}
                {fieldNeedsOptions(f.type) ? (
                  <XStack gap="$2" items="center" pl="$5" flexWrap="wrap">
                    <Label width={90} color="$color10" fontSize="$2">
                      {f.type === 'Select' ? 'Options' : f.type === 'Link' ? 'Relates to' : 'Child type'}
                    </Label>
                    <Input
                      flex={1}
                      minW={200}
                      size="$2"
                      placeholder={f.type === 'Select' ? 'One per line — Draft / Published' : 'Collection name (e.g. Author)'}
                      value={f.options}
                      onChangeText={(v) => patch(f.key, { options: v })}
                      multiline={f.type === 'Select'}
                      numberOfLines={f.type === 'Select' ? 3 : 1}
                      disabled={busy}
                      autoCapitalize="none"
                    />
                  </XStack>
                ) : null}

                <XStack pl="$5" items="center" justify="space-between">
                  {fname ? <Text fontSize="$1" color="$color8">field: {fname}</Text> : <YStack />}
                  {err ? (
                    <XStack gap="$1" items="center"><TriangleAlert size={12} color="var(--red10)" /><Text fontSize="$1" color="$red11">{err}</Text></XStack>
                  ) : null}
                </XStack>
              </YStack>
            )
          })}
        </YStack>

        <XStack>
          <Button size="$2" icon={<Plus size={14} />} onPress={addField} disabled={busy}>Add field</Button>
        </XStack>
      </YStack>

      {showErrors && validation.formError ? (
        <Card borderWidth={1} borderColor="$red7" bg="$red2" p="$3">
          <XStack gap="$2" items="center"><TriangleAlert size={15} /><Text fontSize="$3" color="$red11">{validation.formError}</Text></XStack>
        </Card>
      ) : null}
      {saveError ? (
        <Card borderWidth={1} borderColor="$red7" bg="$red2" p="$3">
          <XStack gap="$2" items="center"><TriangleAlert size={15} /><Text fontSize="$3" color="$red11">{saveError}</Text></XStack>
        </Card>
      ) : null}

      <XStack gap="$2" justify="flex-end">
        <Button size="$3" disabled={busy} onPress={onCancel}>Cancel</Button>
        <PrimaryButton size="$3" disabled={busy} onPress={save}>
          {busy ? 'Saving…' : editing ? 'Save collection' : 'Create collection'}
        </PrimaryButton>
      </XStack>
    </Card>
  )
}

