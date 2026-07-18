/**
 * DNS API — per-org managed DNS zones + records over the hanzodns control plane
 * (`hanzoai/dns`: CoreDNS + the `hanzodns` plugin). Every call is same-origin,
 * keyless and prefix-free (`cloudProxyV1Url('dns/...')` → `<origin>/v1/dns/...`,
 * the /v1-first form — NOTHING before `/v1/`). The console's `app/v1/[...path]`
 * BFF mints a short-lived user bearer from the session and forwards to the cloud
 * `dns` head (org from the token owner), so every zone/record is org-scoped
 * SERVER-SIDE and no credential reaches the browser. The `dns` head is
 * allow-listed in `proxy-allow.ts` (`allowCloudSurface`).
 *
 * Transport is PLAIN REST (raw JSON, 200/201/204) — the hanzodns contract, NOT
 * the casibase envelope: lists wrap as `{ zones|records, total }`, get/create
 * return the bare object. Normalizers are pure + defensive (snake_case tolerant,
 * honest defaults, never throw) so a partial/renamed payload degrades to a real
 * value, never a crash.
 *
 * A zone's `provider` (`authoritative` | `cloudflare` | …) selects the write
 * backend server-side: an `authoritative` zone lives in CoreDNS; a `cloudflare`
 * zone's records are created in Cloudflare via the per-org KMS-sealed connector
 * token. The field is populated by the provider layer; absent → `authoritative`.
 */
import { restGet, restPost, restPatch, restDelete, cloudProxyV1Url } from './client'

// ── Pure helpers (local; honest defaults, never throw) ───────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s.length > 0) : []

// ── Contract ─────────────────────────────────────────────────────────────────

/** Record types the hanzodns store accepts (store.go `ValidRecordTypes`). */
export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS', 'SOA', 'CAA'] as const
export type RecordType = (typeof RECORD_TYPES)[number]

/** The backends a zone can be served from. `authoritative` = CoreDNS in-cluster;
 *  `cloudflare` = synced to Cloudflare via the per-org connector. Open string so a
 *  future provider (`route53`, …) renders honestly without a code change. */
export type DnsProvider = 'authoritative' | 'cloudflare' | (string & {})

/** A DNS zone as the console consumes it (normalized from the hanzodns `zone` shape). */
export interface Zone {
  id: string
  /** FQDN with the trailing dot as the store keys it (e.g. `example.com.`). Used
   *  verbatim in record paths; strip the dot for display with `displayZone`. */
  name: string
  provider: DnsProvider
  status: string
  recordCount: number
  dnssec: boolean
  nameservers: string[]
  updatedAt: string
}

/** A record within a zone. */
export interface DnsRecord {
  id: string
  name: string
  type: RecordType
  ttl: number
  content: string
  priority: number
  proxied: boolean
  updatedAt: string
}

/** Fields the create-record form collects (before it becomes a POST body). */
export interface RecordInput {
  name: string
  type: RecordType
  content: string
  ttl: number
  priority: number
  proxied: boolean
}

// ── Pure logic (unit-tested) ─────────────────────────────────────────────────

/** True iff a record type carries a `priority` (MX / SRV). */
export const hasPriority = (type: string): boolean => type === 'MX' || type === 'SRV'

/** True iff a record type can ride Cloudflare's orange-cloud proxy (A / AAAA / CNAME). */
export const isProxyable = (type: string): boolean => type === 'A' || type === 'AAAA' || type === 'CNAME'

/** A zone is Cloudflare-backed iff its provider says so (case-insensitive). */
export const isCloudflare = (provider: string): boolean => provider.toLowerCase() === 'cloudflare'

/** Human label for a provider badge. */
export const providerLabel = (provider: string): string =>
  isCloudflare(provider) ? 'Cloudflare' : 'Authoritative'

/** FQDN without the trailing dot, for display (`example.com.` → `example.com`). */
export const displayZone = (name: string): string => name.replace(/\.$/, '')

/**
 * Validate a zone name typed in the create form. Returns an error string, or null
 * when valid. Accepts a bare apex domain (`example.com`) — the store FQDN-normalizes
 * it. Rejects empty, whitespace, a scheme/path, or an obviously-malformed label set.
 */
export function validateZoneName(raw: string): string | null {
  const name = raw.trim().replace(/\.$/, '')
  if (!name) return 'Zone name is required.'
  if (/\s/.test(name)) return 'Zone name cannot contain spaces.'
  if (/[/:]/.test(name)) return 'Enter a bare domain (example.com), not a URL.'
  // At least two dot-separated labels, each 1–63 chars of [a-z0-9-], no leading/trailing hyphen.
  const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i
  const labels = name.split('.')
  if (labels.length < 2 || !labels.every((l) => label.test(l))) return 'Enter a valid domain, e.g. example.com.'
  return null
}

/**
 * Validate a record before create/update. Returns an error string, or null when
 * valid. `proxyable`/`cloudflare` gate the Proxied flag (only A/AAAA/CNAME on a
 * Cloudflare zone can be proxied).
 */
export function validateRecord(input: RecordInput): string | null {
  if (!input.name.trim()) return 'Name is required (use @ for the zone apex).'
  if (!RECORD_TYPES.includes(input.type)) return 'Choose a record type.'
  if (!input.content.trim()) return 'Content is required.'
  if (!Number.isInteger(input.ttl) || input.ttl < 0) return 'TTL must be a non-negative whole number of seconds.'
  if (hasPriority(input.type) && (!Number.isInteger(input.priority) || input.priority < 0))
    return 'Priority must be a non-negative whole number.'
  return null
}

/** The POST body for a create-record call (drops fields the type does not use). */
export function createBody(input: RecordInput, cloudflare: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.name.trim(),
    type: input.type,
    content: input.content.trim(),
    ttl: input.ttl,
  }
  if (hasPriority(input.type)) body.priority = input.priority
  // Only a proxyable type on a Cloudflare zone can be proxied; never send a
  // meaningless `proxied:true` for an authoritative zone or a TXT/NS/… record.
  if (cloudflare && isProxyable(input.type)) body.proxied = input.proxied
  return body
}

/**
 * Build the MINIMAL PATCH body for an edit — only the fields that actually changed
 * (the hanzodns `RecordPatch` applies non-nil fields), so an edit never clobbers a
 * field the user didn't touch. Returns `{}` when nothing changed (caller skips the call).
 */
export function patchBody(before: DnsRecord, after: RecordInput, cloudflare: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const name = after.name.trim()
  const content = after.content.trim()
  if (name !== before.name) body.name = name
  if (after.type !== before.type) body.type = after.type
  if (after.ttl !== before.ttl) body.ttl = after.ttl
  if (content !== before.content) body.content = content
  if (hasPriority(after.type) && after.priority !== before.priority) body.priority = after.priority
  if (cloudflare && isProxyable(after.type) && after.proxied !== before.proxied) body.proxied = after.proxied
  return body
}

// ── Normalizers (pure; snake_case tolerant, honest defaults) ─────────────────

export function normalizeZone(raw: unknown): Zone {
  const r = asRecord(raw)
  const provider = str(r.provider) || 'authoritative'
  return {
    id: str(r.id) || str(r.zone) || str(r.name),
    name: str(r.zone) || str(r.name),
    provider,
    status: str(r.status) || 'active',
    recordCount: num(r.record_count ?? r.recordCount ?? r.records),
    dnssec: bool(r.dnssec_enabled ?? r.dnssec ?? r.dnssecEnabled),
    nameservers: strArray(r.nameservers),
    updatedAt: str(r.updated_at) || str(r.updatedAt) || str(r.updatedTime),
  }
}

/** Unwrap the list response (`{ zones, total }` | bare `[]`) → normalized zones. */
export function normalizeZones(payload: unknown): Zone[] {
  const rows = Array.isArray(payload)
    ? payload
    : ((asRecord(payload).zones ?? asRecord(payload).data ?? asRecord(payload).items) as unknown)
  return (Array.isArray(rows) ? rows : []).map(normalizeZone).filter((z) => z.name)
}

export function normalizeRecord(raw: unknown): DnsRecord {
  const r = asRecord(raw)
  const type = str(r.type).toUpperCase()
  return {
    id: str(r.id),
    name: str(r.name),
    type: (RECORD_TYPES as readonly string[]).includes(type) ? (type as RecordType) : (str(r.type) as RecordType),
    ttl: num(r.ttl),
    content: str(r.content) || str(r.value),
    priority: num(r.priority),
    proxied: bool(r.proxied),
    updatedAt: str(r.updated_at) || str(r.updatedAt) || str(r.updatedTime),
  }
}

/** Unwrap the list response (`{ records, total }` | bare `[]`) → normalized records. */
export function normalizeRecords(payload: unknown): DnsRecord[] {
  const rows = Array.isArray(payload)
    ? payload
    : ((asRecord(payload).records ?? asRecord(payload).data ?? asRecord(payload).items) as unknown)
  return (Array.isArray(rows) ? rows : []).map(normalizeRecord).filter((r) => r.id)
}

// ── Network methods (thin — one per hanzodns route) ──────────────────────────

const enc = (s: string): string => encodeURIComponent(s)
const zonesUrl = (): string => cloudProxyV1Url('dns/zones')
const zoneUrl = (zone: string): string => cloudProxyV1Url(`dns/zones/${enc(zone)}`)
const recordsUrl = (zone: string): string => cloudProxyV1Url(`dns/zones/${enc(zone)}/records`)
const recordUrl = (zone: string, id: string): string => cloudProxyV1Url(`dns/zones/${enc(zone)}/records/${enc(id)}`)

export const DnsApi = {
  zones: {
    /** All zones for the current org (org from the Bearer owner). */
    list: (): Promise<Zone[]> => restGet<unknown>(zonesUrl()).then(normalizeZones),
    /** Create a zone by apex domain → the created zone. */
    create: (name: string): Promise<Zone> =>
      restPost<unknown>(zonesUrl(), { zone: name.trim().replace(/\.$/, '') }).then(normalizeZone),
    /** Delete a zone and all its records. */
    remove: (zone: string): Promise<void> => restDelete(zoneUrl(zone)),
  },
  records: {
    /** All records in a zone. */
    list: (zone: string): Promise<DnsRecord[]> => restGet<unknown>(recordsUrl(zone)).then(normalizeRecords),
    /** Create a record in a zone → the created record. */
    create: (zone: string, body: Record<string, unknown>): Promise<DnsRecord> =>
      restPost<unknown>(recordsUrl(zone), body).then(normalizeRecord),
    /** Patch a record (minimal diff) → the updated record. */
    update: (zone: string, id: string, patch: Record<string, unknown>): Promise<DnsRecord> =>
      restPatch<unknown>(recordUrl(zone, id), patch).then(normalizeRecord),
    /** Delete a record from a zone. */
    remove: (zone: string, id: string): Promise<void> => restDelete(recordUrl(zone, id)),
  },
}
