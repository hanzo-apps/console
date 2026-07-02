/**
 * Pure mapping: a Hanzo Base (hanzoai/base) collection schema → @hanzo/data
 * `FieldDefinition[]`, the column model `DataTable` / `RecordForm` render from.
 *
 * Base describes a collection as a list of typed fields (modern key `fields`;
 * legacy PocketBase used `schema`, nesting a type's options under `options`).
 * This adapter is the ONE place that translates Base's field vocabulary into
 * @hanzo/data's, so every Base-backed view in the console renders identically.
 *
 * No I/O and no React — data in, data out, trivially testable. The @hanzo/data
 * imports are `import type` (erased at build), so this module pulls in none of
 * its runtime (the unit test runs in plain Node).
 */
import type { FieldDefinition, FieldType, SelectOption } from '@hanzo/data'

/** One field of a Base collection schema (modern flat shape + legacy `options`). */
export interface BaseField {
  name: string
  type: string
  required?: boolean
  /** Hidden from the API response — never rendered. */
  hidden?: boolean
  /** System field (`id`, `created`, `updated`, …). Skipped except `id`. */
  system?: boolean
  /** select/file/relation: unset or 1 = single value, >1 = multiple. */
  maxSelect?: number
  /** select: the accepted values. */
  values?: string[]
  /** Legacy PocketBase nested `maxSelect`/`values` under `options`. */
  options?: { maxSelect?: number; values?: string[] } & Record<string, unknown>
}

/** A Base collection schema. `fields` is canonical; `schema` is the legacy key. */
export interface BaseCollection {
  /** Base collection id — the value a `relation` field targets (`collectionId`). */
  id?: string
  name?: string
  fields?: BaseField[]
  schema?: BaseField[]
  /** `base` | `auth` | `view` — a `view` collection is read-only. */
  type?: string
  /** Internal Base collection (`_superusers`, `_mfas`, …) — hidden from the browser. */
  system?: boolean
}

/**
 * Base field type → @hanzo/data field type. 1:1 cases only — `select` (single vs
 * multi) and `autodate` (read-only) carry extra shape and are handled in
 * `toFieldDefinition`.
 */
const TYPE_MAP: Record<string, FieldType> = {
  text: 'text',
  number: 'number',
  bool: 'boolean',
  email: 'email',
  url: 'url',
  editor: 'richText',
  date: 'date',
  json: 'json',
  relation: 'relation',
  file: 'files',
  geoPoint: 'json',
}

/** Words rendered upper-case in a humanized label. */
const ACRONYMS = new Set(['id', 'url', 'uuid', 'api', 'ip'])

/** `firstName` / `first_name` → "First Name"; known acronyms upper-cased (`id` → "ID"). */
function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** Effective `maxSelect` of a select/file/relation field (flat shape or legacy `options`). */
const maxSelectOf = (f: BaseField): number => f.maxSelect ?? f.options?.maxSelect ?? 1

/** Accepted values of a select field (flat shape or legacy `options`). */
const valuesOf = (f: BaseField): string[] => f.values ?? f.options?.values ?? []

/** Keep a field unless it is hidden, or a system field other than `id`. */
const isRenderable = (f: BaseField): boolean =>
  typeof f?.name === 'string' && typeof f?.type === 'string' && !f.hidden && (!f.system || f.name === 'id')

/** Translate ONE Base field to a @hanzo/data `FieldDefinition`. */
function toFieldDefinition(f: BaseField): FieldDefinition {
  const base = { name: f.name, label: humanize(f.name) }
  // The only system field that survives `isRenderable` is `id` — server-owned, so
  // it renders as a value everywhere and never enters edit mode (no id input).
  const ro = f.system ? { readOnly: true as const } : {}

  if (f.type === 'select') {
    const options: SelectOption[] = valuesOf(f).map((v) => ({ value: v, label: v }))
    return { ...base, type: maxSelectOf(f) > 1 ? 'multiSelect' : 'select', metadata: { options }, ...ro }
  }
  if (f.type === 'autodate') {
    // Server-assigned create/update timestamps are never user-editable.
    return { ...base, type: 'dateTime', readOnly: true }
  }
  // Unmapped (or future) types render as raw JSON — honest, never a wrong guess.
  return { ...base, type: TYPE_MAP[f.type] ?? 'json', ...ro }
}

/**
 * Map a Base collection schema to the ordered `FieldDefinition[]` a `DataTable`
 * renders. Accepts the modern `fields` key and the legacy `schema` key; skips
 * hidden + system fields (keeping `id`). Total: returns `[]` for an absent or
 * malformed schema.
 */
export function baseCollectionToFields(collection: BaseCollection | null | undefined): FieldDefinition[] {
  const raw = collection?.fields ?? collection?.schema ?? []
  if (!Array.isArray(raw)) return []
  return raw.filter(isRenderable).map(toFieldDefinition)
}
