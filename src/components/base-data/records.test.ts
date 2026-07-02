import { describe, it, expect } from 'vitest'

import type { FieldDefinition } from '@hanzo/data'
import { baseCollectionToFields } from '~/lib/base-data/fields'
import { editableFields, isEditable, recordLabel, savePayload } from '~/components/base-data/records'

/** A realistic mapped field model: id (read-only) + user fields + an autodate. */
const fields: FieldDefinition[] = baseCollectionToFields({
  name: 'contacts',
  fields: [
    { name: 'id', type: 'text', system: true },
    { name: 'name', type: 'text' },
    { name: 'email', type: 'email' },
    { name: 'active', type: 'bool' },
    { name: 'tags', type: 'select', maxSelect: 3, values: ['a', 'b'] },
    { name: 'updated', type: 'autodate' },
  ],
})

describe('isEditable / editableFields', () => {
  it('excludes the read-only id + autodate, keeps the user fields in order', () => {
    expect(editableFields(fields).map((f) => f.name)).toEqual(['name', 'email', 'active', 'tags'])
  })

  it('isEditable is the single !readOnly predicate', () => {
    const id = fields.find((f) => f.name === 'id')!
    const name = fields.find((f) => f.name === 'name')!
    expect(isEditable(id)).toBe(false)
    expect(isEditable(name)).toBe(true)
  })
})

describe('savePayload', () => {
  it('sends only editable field values — never the server-owned id/timestamps', () => {
    const values = { id: 'rec_1', name: 'Ada', email: 'ada@x.io', active: true, tags: ['a'], updated: 'yesterday' }
    expect(savePayload(values, fields)).toEqual({ name: 'Ada', email: 'ada@x.io', active: true, tags: ['a'] })
  })

  it('drops undefined (untouched) fields but keeps meaningful empties (false / [] / "" / 0)', () => {
    const values = { name: '', active: false, tags: [] as string[] } // email untouched (undefined)
    expect(savePayload(values, fields)).toEqual({ name: '', active: false, tags: [] })
  })

  it('is total for an empty draft — sends nothing', () => {
    expect(savePayload({}, fields)).toEqual({})
  })
})

describe('recordLabel', () => {
  it('uses the first non-empty text/email/url value (skipping id)', () => {
    expect(recordLabel({ id: 'rec_1', name: 'Ada Lovelace', email: 'ada@x.io' }, fields)).toBe('Ada Lovelace')
  })

  it('falls back to the id when no text-ish field has a value', () => {
    expect(recordLabel({ id: 'rec_9', name: '' }, fields)).toBe('rec_9')
  })

  it('falls back to a stable placeholder when there is neither', () => {
    expect(recordLabel({}, fields)).toBe('(untitled)')
  })
})
