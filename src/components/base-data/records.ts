/**
 * Pure record-form logic for the Base records surface — the decisions the
 * create/edit views take, isolated from React + I/O so they are trivially
 * testable (data in, data out).
 *
 * The field model is already the mapped @hanzo/data `FieldDefinition[]`
 * (`baseCollectionToFields`), so "editable" is one predicate — `!readOnly` — and
 * read-only-ness lives in ONE place (the mapper marks `id` + autodate timestamps).
 * The `@hanzo/data` import is `import type` (erased), so this module pulls in none
 * of its runtime and the unit test runs in plain Node.
 */
import type { FieldDefinition } from '@hanzo/data'

/** A field the user can edit — everything except server-owned read-only fields
 *  (`id`, the create/update timestamps). Read-only fields still show in the detail
 *  view; they just never render an input. */
export const isEditable = (f: FieldDefinition): boolean => !f.readOnly

/** The editable subset of a collection's fields — the inputs a create/edit form
 *  renders (order preserved). */
export function editableFields(fields: FieldDefinition[]): FieldDefinition[] {
  return fields.filter(isEditable)
}

/**
 * The payload to persist for a create/update: the editable field values only, so a
 * server-owned field (`id`, `created`, `updated`) is NEVER sent back. Fields left
 * `undefined` are dropped, so a partial edit (or a blank create) doesn't push a
 * value the user never entered — Base keeps its own default/previous value.
 */
export function savePayload(
  values: Record<string, unknown>,
  fields: FieldDefinition[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of editableFields(fields)) {
    const v = values[f.name]
    if (v !== undefined) out[f.name] = v
  }
  return out
}

/**
 * A human label for a record — the first non-empty text/email/url field value
 * (skipping the id), else the record id, else a stable placeholder. Used for the
 * detail header and the delete confirmation, so a row is never referred to as
 * "[object Object]".
 */
export function recordLabel(record: Record<string, unknown>, fields: FieldDefinition[]): string {
  const textish = fields.find(
    (f) =>
      f.name !== 'id' &&
      (f.type === 'text' || f.type === 'email' || f.type === 'url') &&
      typeof record[f.name] === 'string' &&
      record[f.name] !== '',
  )
  if (textish) return String(record[textish.name])
  if (typeof record.id === 'string' && record.id) return record.id
  return '(untitled)'
}
