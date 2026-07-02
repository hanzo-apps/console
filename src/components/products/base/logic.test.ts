import { describe, expect, it } from 'vitest'

import {
  FIELD_KINDS,
  newField,
  slugifyName,
  splitValues,
  splitMimeTypes,
  validateCollection,
  toFieldInput,
  toCollectionPayload,
  type BuilderField,
} from './logic'

const field = (over: Partial<BuilderField> = {}): BuilderField => ({ ...newField(), ...over })

describe('FIELD_KINDS — the palette covers file/media + relation', () => {
  it('includes file and relation with the right capability flags', () => {
    const file = FIELD_KINDS.find((k) => k.kind === 'file')
    const relation = FIELD_KINDS.find((k) => k.kind === 'relation')
    const select = FIELD_KINDS.find((k) => k.kind === 'select')
    expect(file?.isFile).toBe(true)
    expect(file?.supportsMulti).toBe(true)
    expect(relation?.needsRelation).toBe(true)
    expect(select?.needsValues).toBe(true)
  })
})

describe('slugifyName + splitters', () => {
  it('slugifies free text to a valid identifier', () => {
    expect(slugifyName('Blog Posts')).toBe('blog_posts')
    expect(slugifyName('  My--Thing!! ')).toBe('my_thing')
    expect(slugifyName('123abc')).toBe('_123abc')
  })
  it('splits + de-dupes select values and mime types', () => {
    expect(splitValues('a, b\nc, a')).toEqual(['a', 'b', 'c'])
    expect(splitMimeTypes('image/png, image/jpeg  video/mp4')).toEqual(['image/png', 'image/jpeg', 'video/mp4'])
  })
})

describe('validateCollection', () => {
  it('requires a valid lower_snake collection name', () => {
    expect(validateCollection('', [field({ name: 'title' })]).nameError).toMatch(/required/)
    expect(validateCollection('Bad Name', [field({ name: 'title' })]).nameError).toMatch(/lower_snake/)
    expect(validateCollection('blog_posts', [field({ name: 'title' })]).ok).toBe(true)
  })
  it('rejects an empty, reserved, duplicate, or malformed field name', () => {
    expect(validateCollection('c', [field({ name: '' })]).fieldErrors).not.toEqual({})
    expect(Object.values(validateCollection('c', [field({ name: 'id' })]).fieldErrors)[0]).toMatch(/reserved/)
    const dup = validateCollection('c', [field({ key: 'a', name: 'x' }), field({ key: 'b', name: 'x' })])
    expect(dup.fieldErrors.b).toMatch(/Duplicate/)
    expect(Object.values(validateCollection('c', [field({ name: 'First Name' })]).fieldErrors)[0]).toMatch(/lower_snake/)
  })
  it('requires values for select and a target for relation', () => {
    expect(Object.values(validateCollection('c', [field({ name: 'status', kind: 'select', values: '' })]).fieldErrors)[0]).toMatch(/option value/)
    expect(Object.values(validateCollection('c', [field({ name: 'author', kind: 'relation', relationTarget: '' })]).fieldErrors)[0]).toMatch(/related/)
    expect(validateCollection('c', [field({ name: 'status', kind: 'select', values: 'draft, live' })]).ok).toBe(true)
  })
  it('needs at least one field', () => {
    expect(validateCollection('c', []).ok).toBe(false)
  })
})

describe('toFieldInput / toCollectionPayload — Base POST body', () => {
  it('maps a text field to the flat Base shape', () => {
    expect(toFieldInput(field({ name: 'title', kind: 'text', required: true }), {})).toEqual({ name: 'title', type: 'text', required: true })
  })
  it('maps select single/multi with de-duped values', () => {
    const single = toFieldInput(field({ name: 'status', kind: 'select', values: 'draft, live, draft', multi: false }), {})
    expect(single).toMatchObject({ type: 'select', maxSelect: 1, values: ['draft', 'live'] })
    const multi = toFieldInput(field({ name: 'tags', kind: 'select', values: 'a\nb', multi: true }), {})
    expect(multi.maxSelect).toBeGreaterThan(1)
  })
  it('maps a file field with mime types + multi', () => {
    const f = toFieldInput(field({ name: 'cover', kind: 'file', multi: true, mimeTypes: 'image/png, image/jpeg' }), {})
    expect(f).toMatchObject({ type: 'file', mimeTypes: ['image/png', 'image/jpeg'] })
    expect(f.maxSelect).toBeGreaterThan(1)
  })
  it('resolves a relation target NAME to its Base collection id', () => {
    const f = toFieldInput(field({ name: 'author', kind: 'relation', relationTarget: 'users' }), { users: 'col_123' })
    expect(f).toMatchObject({ type: 'relation', collectionId: 'col_123', cascadeDelete: false })
    // Falls back to the raw value when the name isn't in the map (honest, not silent-drop).
    expect(toFieldInput(field({ name: 'author', kind: 'relation', relationTarget: 'col_x' }), {}).collectionId).toBe('col_x')
  })
  it('builds the whole collection payload', () => {
    const payload = toCollectionPayload('blog_posts', [field({ name: 'title', kind: 'text' })], {})
    expect(payload).toMatchObject({ name: 'blog_posts', type: 'base' })
    expect(payload.fields).toHaveLength(1)
  })
})
