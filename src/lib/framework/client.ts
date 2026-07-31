/**
 * FrameworkApi — the ONE generic client for the Hanzo Framework DocType engine
 * (cloud `clients/framework`, live at /v1/framework/*). It is metadata-driven and
 * doctype-agnostic: the SAME `records` CRUD serves a CMS Page, an ERP Invoice, or
 * a Helpdesk Ticket — an app lane is just a `module` filter over `doctypes`. This
 * is the client half of the "one engine + one renderer renders every business
 * app" thesis; the generic @hanzo/data DocType renderer drives it.
 *
 * Every call goes through the console's OWN user-bearer `/v1` proxy
 * (`cloudProxyV1Url('framework/...')`, the same per-tenant path CRM/Prompts/Agents
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
import { restGet, restPost, restPut, restDelete, cloudProxyV1Url } from '~/lib/api/client'
import type {
  Change,
  ChangeFeed,
  ChangeQuery,
  DocType,
  FrameworkDoc,
  ListQuery,
  ModuleInfo,
  InstallResult,
  Viewer,
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

const url = (path: string): string => cloudProxyV1Url(`${BASE}/${path}`)

/**
 * Build the change-feed querystring. ONE function for the poll and the stream,
 * because they are ONE server-side query — the stream is that query in a loop.
 * Exported for testing.
 */
export function changeQuery(q?: ChangeQuery & { watching?: string }): string {
  const p = new URLSearchParams()
  if (q?.doctypes?.length) p.set('doctypes', q.doctypes.join(','))
  if (q?.modules?.length) p.set('modules', q.modules.join(','))
  if (q?.since) p.set('since', String(q.since))
  if (q?.limit) p.set('limit', String(q.limit))
  if (q?.watching) p.set('watching', q.watching)
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** `<DocType>/<name>` — the ONE way a document is named to the live surface.
 *  A Single needs no name. Split server-side at the FIRST slash. */
export const watching = (doctype: string, name?: string): string =>
  name ? `${doctype}/${name}` : doctype

const asChange = (v: unknown): Change => {
  const r = asRecord(v)
  return {
    seq: Number(r.seq ?? 0),
    doctype: String(r.doctype ?? ''),
    module: r.module ? String(r.module) : undefined,
    name: String(r.name ?? ''),
    action: String(r.action ?? '') as Change['action'],
    docstatus: Number(r.docstatus ?? 0),
    at: Number(r.at ?? 0),
  }
}

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

  /**
   * The change feed — the ONE way anything here learns a document changed, for
   * EVERY doctype. `list` is one page; `subscribe` is the same query held open
   * as Server-Sent Events. A view renders current state from `records.list`,
   * takes the `cursor` it gets back, and applies changes from there.
   */
  changes: {
    list: (q?: ChangeQuery): Promise<ChangeFeed> =>
      restGet<unknown>(url(`changes${changeQuery(q)}`)).then((v) => {
        const r = asRecord(v)
        return {
          changes: rows(r.changes ?? v).map(asChange),
          cursor: Number(r.cursor ?? 0),
          reset: r.reset === true,
        }
      }),

    /**
     * Hold the feed open. Returns the unsubscribe.
     *
     * EventSource, not WebSocket, and it needs no credential: it is a same-origin
     * GET through the console's `/v1` bearer proxy, so it carries the session
     * cookie and the ORG is resolved server-side from the minted bearer's owner
     * claim. A browser can never name its own tenant.
     *
     * The browser also resumes for us: each frame's `id` is the change's `seq`,
     * so a dropped connection reconnects with `Last-Event-ID` and misses nothing.
     * Passing `watching` additionally declares presence for as long as the
     * connection lives — that is why no client→server channel is needed.
     *
     * `onReset` fires when the cursor fell behind the server's retention window:
     * refetch current state before applying anything further.
     */
    subscribe: (
      q: (ChangeQuery & { watching?: string }) | undefined,
      handlers: {
        onChange: (c: Change) => void
        onSync?: (cursor: number) => void
        onReset?: (cursor: number) => void
        onError?: (e: Event) => void
      },
    ): (() => void) => {
      if (typeof EventSource === 'undefined') return () => {} // SSR: nothing to open
      const es = new EventSource(url(`stream${changeQuery(q)}`))
      const cursorOf = (e: MessageEvent): number => Number(asRecord(JSON.parse(e.data)).cursor ?? 0)
      es.addEventListener('change', (e) => handlers.onChange(asChange(JSON.parse((e as MessageEvent).data))))
      es.addEventListener('sync', (e) => handlers.onSync?.(cursorOf(e as MessageEvent)))
      es.addEventListener('reset', (e) => handlers.onReset?.(cursorOf(e as MessageEvent)))
      if (handlers.onError) es.onerror = handlers.onError
      return () => es.close()
    },
  },

  /**
   * Who is viewing a document right now. Joins and leaves arrive on the change
   * feed above as `present`/`away` on the named document; this reads the roster
   * they point at — the same rule documents follow (the feed says WHAT changed,
   * the client re-reads the value).
   */
  presence: {
    list: (doctype: string, name?: string): Promise<Viewer[]> =>
      restGet<unknown>(url(`presence${changeQuery({ watching: watching(doctype, name) })}`)).then((r) =>
        rows(r).map((v) => ({ user: String(v.user ?? ''), since: Number(v.since ?? 0) })),
      ),
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
