/**
 * Pure logic for the Base content-type builder — the field-kind catalog,
 * validation, and the mapping from the builder's UI state to Base's `POST
 * /v1/collections` body. No I/O, no React: data in, data out, unit-testable in
 * plain Node. The UI (`CollectionBuilder.tsx`) is a thin shell over this.
 *
 * There is ONE place that knows how a chosen field kind becomes a Base field
 * (type + options) — here — mirroring `base-data/fields.ts` (the reverse map,
 * Base schema → render model). We never hand-write Base field JSON in the UI.
 */
import type { CollectionFieldInput, CollectionInput } from '~/lib/base-data/api'

/** The buildable field kinds (a friendly subset/rename of Base's 13 field types). */
export type FieldKind =
  | 'text'
  | 'editor'
  | 'number'
  | 'bool'
  | 'date'
  | 'email'
  | 'url'
  | 'select'
  | 'file'
  | 'relation'
  | 'json'
  | 'geoPoint'

export interface FieldKindSpec {
  kind: FieldKind
  /** The Base field `type` this maps to. */
  baseType: string
  label: string
  hint: string
  /** select / file / relation carry a single-vs-multiple choice. */
  supportsMulti?: boolean
  /** select needs a value list. */
  needsValues?: boolean
  /** relation needs a target collection. */
  needsRelation?: boolean
  /** file accepts MIME-type restrictions. */
  isFile?: boolean
}

/** The palette, in display order (Supabase-style table-editor type list). */
export const FIELD_KINDS: FieldKindSpec[] = [
  { kind: 'text', baseType: 'text', label: 'Text', hint: 'Short single-line text' },
  { kind: 'editor', baseType: 'editor', label: 'Rich text', hint: 'Formatted long-form content' },
  { kind: 'number', baseType: 'number', label: 'Number', hint: 'Integer or decimal' },
  { kind: 'bool', baseType: 'bool', label: 'Boolean', hint: 'True / false toggle' },
  { kind: 'date', baseType: 'date', label: 'Date', hint: 'Date & time' },
  { kind: 'email', baseType: 'email', label: 'Email', hint: 'Validated email address' },
  { kind: 'url', baseType: 'url', label: 'URL', hint: 'Validated web link' },
  { kind: 'select', baseType: 'select', label: 'Select', hint: 'Pick from a fixed list', supportsMulti: true, needsValues: true },
  { kind: 'file', baseType: 'file', label: 'File / Media', hint: 'Upload files (images, docs, video)', supportsMulti: true, isFile: true },
  { kind: 'relation', baseType: 'relation', label: 'Relation', hint: 'Link to another content type', supportsMulti: true, needsRelation: true },
  { kind: 'json', baseType: 'json', label: 'JSON', hint: 'Arbitrary structured data' },
  { kind: 'geoPoint', baseType: 'geoPoint', label: 'Geo point', hint: 'Latitude / longitude' },
]

export const kindSpec = (kind: FieldKind): FieldKindSpec =>
  FIELD_KINDS.find((k) => k.kind === kind) ?? FIELD_KINDS[0]

/** One field row in the builder's UI state (raw inputs; mapped to Base at submit). */
export interface BuilderField {
  /** Stable UI key (not sent to Base). */
  key: string
  name: string
  kind: FieldKind
  required: boolean
  /** select / file / relation: multiple values allowed. */
  multi: boolean
  /** select: raw values, one per line or comma-separated. */
  values: string
  /** relation: the TARGET collection NAME (mapped to its id at payload build). */
  relationTarget: string
  /** file: raw comma-separated MIME types (empty ⇒ any). */
  mimeTypes: string
}

let seq = 0
/** A fresh, empty builder field (defaults to Text). */
export function newField(kind: FieldKind = 'text'): BuilderField {
  seq += 1
  return { key: `f${seq}-${Math.random().toString(36).slice(2, 7)}`, name: '', kind, required: false, multi: false, values: '', relationTarget: '', mimeTypes: '' }
}

/** Valid Base identifier for a collection/field name: lower snake, starts with a letter. */
const IDENT = /^[a-z][a-z0-9_]*$/
/** Names Base owns / reserves — a field may not use them. */
const RESERVED_FIELD_NAMES = new Set(['id', 'created', 'updated'])

/** Normalize free text to a valid identifier candidate (for the "did you mean" nudge). */
export function slugifyName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, '_$1')
}

/** Split a raw values textarea into a clean, de-duplicated list. */
export function splitValues(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[\n,]/)) {
    const v = part.trim()
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

/** Split a raw comma/space-separated MIME list. */
export function splitMimeTypes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface ValidationResult {
  ok: boolean
  /** Error for the collection name, if any. */
  nameError?: string
  /** Errors keyed by field `key`. */
  fieldErrors: Record<string, string>
}

/** Validate the whole content type. Pure — the UI renders these messages inline. */
export function validateCollection(name: string, fields: BuilderField[]): ValidationResult {
  const fieldErrors: Record<string, string> = {}
  let nameError: string | undefined

  const n = name.trim()
  if (!n) nameError = 'Name is required.'
  else if (!IDENT.test(n)) nameError = 'Use lower_snake_case, starting with a letter (e.g. blog_posts).'

  if (fields.length === 0) {
    // Surfaced by the caller as a general "add at least one field" message.
    return { ok: false, nameError, fieldErrors }
  }

  const seenNames = new Set<string>()
  for (const f of fields) {
    const fn = f.name.trim()
    if (!fn) fieldErrors[f.key] = 'Field name is required.'
    else if (!IDENT.test(fn)) fieldErrors[f.key] = 'Use lower_snake_case (e.g. first_name).'
    else if (RESERVED_FIELD_NAMES.has(fn)) fieldErrors[f.key] = `"${fn}" is reserved by Base.`
    else if (seenNames.has(fn)) fieldErrors[f.key] = 'Duplicate field name.'
    else {
      seenNames.add(fn)
      const spec = kindSpec(f.kind)
      if (spec.needsValues && splitValues(f.values).length === 0) fieldErrors[f.key] = 'Add at least one option value.'
      else if (spec.needsRelation && !f.relationTarget.trim()) fieldErrors[f.key] = 'Choose the related content type.'
    }
  }

  const ok = !nameError && fields.length > 0 && Object.keys(fieldErrors).length === 0
  return { ok, nameError, fieldErrors }
}

/** Multiple ⇒ a large maxSelect; single ⇒ 1 (Base treats maxSelect>1 as multi-value). */
const MULTI_MAX = 99
const maxSelectFor = (f: BuilderField): number => (f.multi ? MULTI_MAX : 1)

/**
 * Map one builder field → a Base `CollectionFieldInput` (flat modern options).
 * `targetsByName` resolves a relation's target collection NAME → its Base id.
 */
export function toFieldInput(f: BuilderField, targetsByName: Record<string, string>): CollectionFieldInput {
  const spec = kindSpec(f.kind)
  const out: CollectionFieldInput = { name: f.name.trim(), type: spec.baseType, required: f.required }
  if (f.kind === 'select') {
    out.maxSelect = maxSelectFor(f)
    out.values = splitValues(f.values)
  } else if (f.kind === 'file') {
    out.maxSelect = maxSelectFor(f)
    const mimes = splitMimeTypes(f.mimeTypes)
    if (mimes.length) out.mimeTypes = mimes
  } else if (f.kind === 'relation') {
    out.maxSelect = maxSelectFor(f)
    out.collectionId = targetsByName[f.relationTarget.trim()] ?? f.relationTarget.trim()
    out.cascadeDelete = false
  }
  return out
}

/** Map the whole builder state → the Base `POST /v1/collections` body. */
export function toCollectionPayload(
  name: string,
  fields: BuilderField[],
  targetsByName: Record<string, string> = {},
): CollectionInput {
  return { name: name.trim(), type: 'base', fields: fields.map((f) => toFieldInput(f, targetsByName)) }
}
