/**
 * Pure logic for the Bases manager (Hanzo Base instances) — slug derivation,
 * validation, size presets, and status presentation. No I/O, no React: data in,
 * data out, unit-testable in plain Node. `BasesManager.tsx` is the thin shell.
 */
import type { BaseSpec } from '~/lib/base-data/tenants'

/** A DNS-label slug: lowercase alnum + internal hyphens, starts/ends alnum, ≤40. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
/** Route words the Base product owns — a Base may not take a slug that shadows them. */
const RESERVED_SLUGS = new Set(['new'])

/** Normalize free text into a valid Base slug candidate. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

export interface BaseValidation {
  ok: boolean
  nameError?: string
  slugError?: string
}

/** Validate a new Base. Pure — the form renders these messages inline. */
export function validateBase(name: string, slug: string, existingSlugs: string[] = []): BaseValidation {
  let nameError: string | undefined
  let slugError: string | undefined

  if (!name.trim()) nameError = 'Name is required.'

  const s = slug.trim()
  if (!s) slugError = 'Slug is required.'
  else if (!isValidSlug(s)) slugError = 'Use lowercase letters, numbers, and hyphens (e.g. my-base).'
  else if (RESERVED_SLUGS.has(s)) slugError = `“${s}” is reserved.`
  else if (existingSlugs.includes(s)) slugError = 'A Base with this slug already exists.'

  return { ok: !nameError && !slugError, nameError, slugError }
}

/** Size presets → a Base spec (replicas + storage). ONE control, not raw K8s. */
export interface SizePreset {
  id: string
  label: string
  hint: string
  spec: BaseSpec
}
export const SIZE_PRESETS: SizePreset[] = [
  { id: 'starter', label: 'Starter', hint: '1 replica · 1 GB storage', spec: { replicas: 1, storage: '1Gi' } },
  { id: 'standard', label: 'Standard', hint: '2 replicas · 10 GB storage', spec: { replicas: 2, storage: '10Gi' } },
  { id: 'ha', label: 'High availability', hint: '3 replicas · 50 GB storage', spec: { replicas: 3, storage: '50Gi' } },
]
export const DEFAULT_SIZE = 'standard'

/** The spec for a preset id (falls back to the default). */
export function specForSize(id: string): BaseSpec {
  return (SIZE_PRESETS.find((p) => p.id === id) ?? SIZE_PRESETS[1]).spec
}

/** Which preset a spec matches, or `custom` when it matches none. */
export function sizeForSpec(spec: BaseSpec): string {
  const m = SIZE_PRESETS.find((p) => p.spec.replicas === spec.replicas && p.spec.storage === spec.storage)
  return m ? m.id : 'custom'
}

/** A human summary of a spec, for the list/detail rows (honest '—' when empty). */
export function specSummary(spec: BaseSpec): string {
  const parts: string[] = []
  if (spec.replicas !== undefined) parts.push(`${spec.replicas} ${spec.replicas === 1 ? 'replica' : 'replicas'}`)
  if (spec.storage) parts.push(spec.storage)
  return parts.length ? parts.join(' · ') : '—'
}

/** Status presentation — the provisioning lifecycle derived from controller fields. */
export type StatusTone = 'ready' | 'pending' | 'error'
export interface BaseStatus {
  label: string
  tone: StatusTone
  ready: boolean
}
export function statusOf(base: { status: string; subdomain: string; lastError: string }): BaseStatus {
  if (base.lastError.trim()) return { label: 'Error', tone: 'error', ready: false }
  const s = base.status.trim()
  const sl = s.toLowerCase()
  if (sl === 'error' || sl === 'failed') return { label: s || 'Error', tone: 'error', ready: false }
  if (base.subdomain.trim() && (sl === '' || sl === 'ready' || sl === 'running' || sl === 'active')) {
    return { label: 'Ready', tone: 'ready', ready: true }
  }
  if (!s) return { label: 'Provisioning', tone: 'pending', ready: false }
  return { label: s, tone: 'pending', ready: false }
}

/** The live URL for a ready Base (its own subdomain), or null while provisioning. */
export function baseHref(base: { subdomain: string }): string | null {
  const sd = base.subdomain.trim()
  if (!sd) return null
  return /^https?:\/\//.test(sd) ? sd : `https://${sd}`
}
