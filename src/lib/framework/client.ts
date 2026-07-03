/**
 * FrameworkApi — the ONE generic client for the Hanzo Framework DocType engine
 * (cloud `clients/framework`, live at /v1/framework/*). It is metadata-driven and
 * doctype-agnostic: the SAME `records` CRUD serves a CMS Page, an ERP Invoice, or
 * a Helpdesk Ticket — an app lane is just a `module` filter over `doctypes`. This
 * is the client half of the "one engine + one renderer renders every business
 * app" thesis; the generic @hanzo/data DocType renderer drives it.
 *
 * Every call goes through the console's OWN user-bearer `/cloud` proxy
 * (`originV1Url('framework/...')`, the same per-tenant path CRM/Prompts/Agents
 * use, allow-listed as the `framework` head): the server mints a short-lived
 * user-bound IAM token and the engine resolves the org from the token's `owner`
 * claim (principal.Tenant), so every read/write is org-scoped SERVER-SIDE and no
 * credential reaches the browser. A cookie-only or forged-header call 403s, so the
 * proxy is mandatory.
 *
 * Names (DocType + document) are used verbatim in the URL path, so the console
 * keeps them slug-style (no spaces/`%`): `slugify` on create + `encodeURIComponent`
 * on read. Payloads are read defensively from `{ data }` (or a bare array), so a
 * shape drift degrades a list rather than throwing.
 */
import { restGet, restPost, restPut, restDelete, originV1Url } from '~/lib/api/client'
import type {
  DocType,
  FrameworkDoc,
  ListQuery,
  ModuleInfo,
  InstallResult,
} from './types'

const BASE = 'framework'
const enc = encodeURIComponent

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Pull the first array under a common envelope key (the engine uses `data`). */
function rows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  const o = asRecord(payload)
  for (const k of ['data', 'items', 'rows']) {
    if (Array.isArray(o[k])) return (o[k] as unknown[]).filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  }
  return []
}

/** A framework document is already a flat map + envelope; keep it as-is (typed). */
const asDoc = (v: unknown): FrameworkDoc => asRecord(v) as FrameworkDoc
const asDocType = (v: unknown): DocType => {
  const r = asRecord(v)
  return { ...(r as object), name: String(r.name ?? ''), fields: Array.isArray(r.fields) ? (r.fields as DocType['fields']) : [] } as DocType
}

/** Build the generic document list querystring from a typed ListQuery. Exported for testing. */
export function listQuery(q?: ListQuery): string {
  if (!q) return ''
  const p = new URLSearchParams()
  if (q.filters && Object.keys(q.filters).length) p.set('filters', JSON.stringify(q.filters))
  if (q.fields && q.fields.length) p.set('fields', q.fields.join(','))
  if (q.orderBy) p.set('order_by', q.orderBy)
  if (q.limit) p.set('limit', String(q.limit))
  const s = p.toString()
  return s ? `?${s}` : ''
}

const url = (path: string): string => originV1Url(`${BASE}/${path}`)

export const FrameworkApi = {
  /** The DocType registry (schemas) — the collection definitions of every app lane. */
  doctypes: {
    list: (): Promise<DocType[]> => restGet<unknown>(url('doctypes')).then((r) => rows(r).map(asDocType)),
    get: (name: string): Promise<DocType> => restGet<unknown>(url(`doctypes/${enc(name)}`)).then(asDocType),
    create: (dt: DocType): Promise<DocType> => restPost<unknown>(url('doctypes'), dt).then(asDocType),
    update: (name: string, dt: DocType): Promise<DocType> => restPut<unknown>(url(`doctypes/${enc(name)}`), dt).then(asDocType),
    remove: (name: string): Promise<void> => restDelete(url(`doctypes/${enc(name)}`)),
  },

  /** Generic, metadata-driven document CRUD — the SAME calls for ANY doctype. */
  records: {
    list: (doctype: string, q?: ListQuery): Promise<FrameworkDoc[]> =>
      restGet<unknown>(url(`${enc(doctype)}${listQuery(q)}`)).then((r) => rows(r).map(asDoc)),
    get: (doctype: string, name: string): Promise<FrameworkDoc> =>
      restGet<unknown>(url(`${enc(doctype)}/${enc(name)}`)).then(asDoc),
    create: (doctype: string, data: Record<string, unknown>): Promise<FrameworkDoc> =>
      restPost<unknown>(url(enc(doctype)), data).then(asDoc),
    update: (doctype: string, name: string, data: Record<string, unknown>): Promise<FrameworkDoc> =>
      restPut<unknown>(url(`${enc(doctype)}/${enc(name)}`), data).then(asDoc),
    remove: (doctype: string, name: string): Promise<void> =>
      restDelete(url(`${enc(doctype)}/${enc(name)}`)),
    submit: (doctype: string, name: string): Promise<FrameworkDoc> =>
      restPost<unknown>(url(`${enc(doctype)}/${enc(name)}/submit`)).then(asDoc),
    cancel: (doctype: string, name: string): Promise<FrameworkDoc> =>
      restPost<unknown>(url(`${enc(doctype)}/${enc(name)}/cancel`)).then(asDoc),
  },

  /** App-lane fixtures: list the registered lanes, inspect one, install into the org. */
  modules: {
    list: (): Promise<ModuleInfo[]> =>
      restGet<unknown>(url('modules')).then((r) => rows(r).map((m) => ({
        module: String(m.module ?? ''),
        doctypes: Array.isArray(m.doctypes) ? (m.doctypes as string[]) : [],
      }))),
    get: (module: string): Promise<ModuleInfo> =>
      restGet<unknown>(url(`modules/${enc(module)}`)).then((v) => {
        const r = asRecord(v)
        return {
          module: String(r.module ?? module),
          doctypes: Array.isArray(r.doctypes) ? (r.doctypes as string[]) : [],
          installed: Array.isArray(r.installed) ? (r.installed as string[]) : [],
        }
      }),
    install: (module: string): Promise<InstallResult> =>
      restPost<unknown>(url(`modules/${enc(module)}/install`)).then((v) => {
        const r = asRecord(v)
        return {
          module: String(r.module ?? module),
          created: Array.isArray(r.created) ? (r.created as string[]) : [],
          existing: Array.isArray(r.existing) ? (r.existing as string[]) : [],
        }
      }),
  },

  /** Per-org role assignments (grant editors; the owner is seeded System Manager). */
  roles: {
    list: (): Promise<{ user: string; role: string }[]> =>
      restGet<unknown>(url('roles')).then((r) => rows(r).map((x) => ({ user: String(x.user ?? ''), role: String(x.role ?? '') }))),
    assign: (user: string, role: string): Promise<void> => restPost(url('roles'), { user, role }).then(() => undefined),
    revoke: (user: string, role: string): Promise<void> => restDelete(url(`roles/${enc(user)}/${enc(role)}`)),
  },
}

export type FrameworkClient = typeof FrameworkApi
