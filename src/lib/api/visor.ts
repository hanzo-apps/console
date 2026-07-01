/**
 * Visor — the CUSTOMER compute surface (a tenant's own machines), via the
 * same-origin user-bearer proxy `app/vm/[...path]/route.ts` → `visor.hanzo.svc/v1/*`.
 *
 * This is deliberately NOT the `/paas` platform control plane (a god-mode SERVICE
 * token, admin-only, which 501s "PAAS_SERVICE_TOKEN not set" until wired). Compute
 * is a TENANT action: any signed-in org user may list their OWN machines, and
 * visor scopes them from the forwarded user JWT. So a customer (like a demo user)
 * reads real machines here with only their session cookie — never the infra token,
 * never the infra "not configured" message.
 *
 * Honest by construction: every field is normalized defensively (an upstream field
 * rename degrades a cell to `—`, never throws), an empty list is a real "no
 * machines yet" state, and a not-routed/unavailable upstream degrades to a
 * customer-appropriate "managed compute" state — NOT an infra error.
 */
import { restGet, ApiError } from './client'

const vm = (path: string): string => `/vm/v1/${path.replace(/^\/+/, '')}`

/** One customer machine as visor reports it. Missing fields render `—`. */
export type VisorMachine = {
  id: string
  name?: string
  region?: string
  /** Machine size / type slug (e.g. `s-2vcpu-4gb`, `gpu-h100x1-80gb`). */
  type?: string
  /** Lifecycle string (e.g. `active`, `running`, `provisioning`, `off`). */
  status?: string
  vcpu?: number
  memGb?: number
  /** Accelerator model if this is a GPU machine (e.g. `H100`). */
  gpu?: string
  /** Public IPv4, if any. */
  ip?: string
  createdAt?: string
  /** Hourly price in USD, if visor reports it. */
  costHourlyUsd?: number
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined

/** Pull the first array found under any common envelope key (else `[]`). */
function arrayUnder(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload
  const o = rec(payload)
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
  return []
}

export function normalizeMachine(raw: unknown, i = 0): VisorMachine {
  const r = rec(raw)
  const id = str(r.id) ?? str(r.uuid) ?? str(r.machineId) ?? str(r.name) ?? `machine-${i}`
  const gpu = r.gpu ?? r.gpus ?? r.accelerator
  return {
    id,
    name: str(r.name) ?? str(r.hostname) ?? str(r.label) ?? id,
    region: str(r.region) ?? str(r.zone) ?? str(r.datacenter) ?? str(r.location),
    type: str(r.type) ?? str(r.size) ?? str(r.machineType) ?? str(r.slug) ?? str(r.plan),
    status: str(r.status) ?? str(r.state) ?? str(r.phase),
    vcpu: num(r.vcpu) ?? num(r.vcpus) ?? num(r.cpu) ?? num(r.cores),
    memGb: num(r.memGb) ?? num(r.memoryGb) ?? num(r.ramGb) ?? num(r.memory),
    gpu: str(gpu) ?? str(rec(gpu).model) ?? (num(rec(gpu).count) ? str(rec(gpu).type) : undefined),
    ip: str(r.ip) ?? str(r.publicIp) ?? str(r.ipv4) ?? str(r.address),
    createdAt: str(r.createdAt) ?? str(r.created) ?? str(r.createdTime) ?? str(r.created_at),
    costHourlyUsd: num(r.costHourlyUsd) ?? num(r.costHourly) ?? num(r.priceHourly) ?? num(r.hourly),
  }
}

/** What a customer compute view should show, derived from an upstream failure. */
export type VisorErrorKind = 'unauthorized' | 'unavailable'
export type VisorError = { kind: VisorErrorKind; message: string }

/**
 * Map an error to a CUSTOMER-appropriate state. 401/403 → sign-in; anything else
 * (404 not-routed, 501/502/503, network) → "managed compute / not available here",
 * NEVER an infra-token message (that is only ever an admin concern).
 */
export function interpretVisorError(e: unknown): VisorError {
  const status = e instanceof ApiError ? e.status : undefined
  if (status === 401 || status === 403) return { kind: 'unauthorized', message: 'Sign in to view your machines.' }
  return {
    kind: 'unavailable',
    message: 'Managed compute — dedicated machines appear here once you launch one.',
  }
}

export const VisorApi = {
  /** The signed-in org's own machines (user-scoped by visor). */
  machines: async (): Promise<VisorMachine[]> => {
    const r = await restGet<unknown>(vm('machines'))
    return arrayUnder(r, ['machines', 'instances', 'data', 'items', 'rows', 'droplets']).map((m, i) => normalizeMachine(m, i))
  },
}

// ── Formatters (cells) ───────────────────────────────────────────────────────

export const DASH = '—'
export const fmtSpec = (m: VisorMachine): string =>
  m.vcpu != null && m.memGb != null ? `${m.vcpu} vCPU · ${m.memGb} GB` : m.vcpu != null ? `${m.vcpu} vCPU` : DASH
export const fmtHourly = (n?: number): string => (n == null ? DASH : `$${n.toFixed(2)}/hr`)
export const fmtMonthly = (n?: number): string => (n == null ? DASH : `$${Math.round(n * 730).toLocaleString()}/mo`)

/** Coarse status → a health verdict for a pill (green/yellow/red/neutral). PURE. */
export function statusVerdict(status?: string): 'ok' | 'warn' | 'down' | 'idle' {
  const s = (status ?? '').toLowerCase()
  if (['active', 'running', 'online', 'ready', 'up'].includes(s)) return 'ok'
  if (['provisioning', 'pending', 'starting', 'rebooting', 'busy'].includes(s)) return 'warn'
  if (['off', 'stopped', 'terminated', 'error', 'failed', 'offline', 'down'].includes(s)) return 'down'
  return 'idle'
}
