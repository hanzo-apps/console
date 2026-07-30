/**
 * Typed client for the ORG-SCOPED audit trail (cloud `clients/auditlog`), called
 * SAME-ORIGIN with NO prefix (`originV1Url('audit')`). The next.config rewrite
 * terminates it at the console's `/v1` user-bearer proxy, which mints a
 * short-lived user Bearer and forwards to cloud-api; the org is PINNED
 * server-authoritatively from the Bearer owner claim (a client `org` param is
 * ignored), so an org admin reads ONLY their OWN org's security events.
 *
 * This is the customer-facing twin of the admin god-view (`/v1/admin/audit`): the
 * SAME tamper-evident, hash-chained store, scoped to the caller. The response is the
 * `{status,data,total}` envelope (data = rows, total for pagination — legacy
 * emitters send it as `data2`), so we read it defensively via `restGet` and never
 * throw on a shape drift.
 *
 * Field names mirror the Go `audit.Wire` struct exactly.
 */
import { restGet, originV1Url, envelopeTotal } from './client'

// ── Defensive coercion ───────────────────────────────────────────────────────
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return 0
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const arrayOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** One audit record (mirrors Go audit.Wire). Hash/prevHash are the tamper-evidence
 *  chain linkage; result is success|deny|error. */
export type AuditEvent = {
  seq: number
  time: string
  org: string
  sub: string
  email: string
  action: string
  resource: string
  resourceId: string
  method: string
  path: string
  result: string
  status: number
  reason: string
  sourceIp: string
  userAgent: string
  requestId: string
  isAdmin: boolean
  authMethod: string
  hash: string
  prevHash: string
}

/** The filter set the org-scoped trail accepts (org is pinned server-side). */
export type AuditQuery = {
  action?: string
  resource?: string
  resourceId?: string
  result?: string
  sub?: string
  since?: string // RFC3339
  until?: string // RFC3339
  pageSize?: number
  page?: number
}

export function normalizeEvent(raw: unknown): AuditEvent {
  const r = asRecord(raw)
  return {
    seq: num(r.seq),
    time: str(r.time),
    org: str(r.org),
    sub: str(r.sub),
    email: str(r.email),
    action: str(r.action),
    resource: str(r.resource),
    resourceId: str(r.resourceId),
    method: str(r.method),
    path: str(r.path),
    result: str(r.result),
    status: num(r.status),
    reason: str(r.reason),
    sourceIp: str(r.sourceIp),
    userAgent: str(r.userAgent),
    requestId: str(r.requestId),
    isAdmin: bool(r.isAdmin),
    authMethod: str(r.authMethod),
    hash: str(r.hash),
    prevHash: str(r.prevHash),
  }
}

/** The list result: normalized rows + the server-reported total (for pagination). */
export type AuditPage = { rows: AuditEvent[]; total: number }

const buildUrl = (query: AuditQuery): string => {
  const sp = new URLSearchParams()
  if (query.action) sp.set('action', query.action)
  if (query.resource) sp.set('resource', query.resource)
  if (query.resourceId) sp.set('resourceId', query.resourceId)
  if (query.result) sp.set('result', query.result)
  if (query.sub) sp.set('sub', query.sub)
  if (query.since) sp.set('since', query.since)
  if (query.until) sp.set('until', query.until)
  if (query.pageSize && query.pageSize > 0) sp.set('pageSize', String(query.pageSize))
  if (query.page && query.page > 1) sp.set('p', String(query.page))
  const s = sp.toString()
  return originV1Url(`audit${s ? `?${s}` : ''}`)
}

/**
 * AuditApi.list — the caller's OWN org audit trail, newest first. Reads the
 * `{status,data,total}` envelope (legacy `data2` accepted): data = the rows,
 * total = the count matching the filter (ignoring pagination) so the UI can
 * page. Org is server-pinned.
 */
export const AuditApi = {
  list: (query: AuditQuery = {}): Promise<AuditPage> =>
    restGet<unknown>(buildUrl(query)).then((raw) => {
      const env = asRecord(raw)
      const rows = arrayOf(env.data).map(normalizeEvent)
      return { rows, total: envelopeTotal(env, rows) }
    }),
}
