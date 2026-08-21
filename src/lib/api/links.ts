/**
 * Login-manager client — the browser face of the cloud `/v1/link` registry: the
 * org+user-scoped record of which AI provider accounts (Claude Max, ChatGPT Plus, a
 * Hanzo/api key) are signed in on which machines, with each account's live usage.
 *
 * Same-origin, keyless, prefix-free (`cloudProxyV1Url('link')` → `<origin>/v1/link`):
 * the `link` head terminates at the console's `app/v1` user-bearer BFF (org from the
 * token owner, user from the validated subject; a cookie-only call 403s) in the
 * standalone build, and at cloud's native `/v1/link` under the session cookie in the
 * go:embed build. Bare JSON (not the casibase envelope), so the plain-REST transport.
 *
 * Payloads are normalized DEFENSIVELY (snake_case tolerated, missing fields → honest
 * defaults) so a partial/renamed backend response degrades instead of throwing.
 */
import { restGet, restPost, restDelete, cloudProxyV1Url } from './client'

const url = (p: string): string => {
  const clean = p.replace(/^\/+/, '')
  return cloudProxyV1Url(clean ? `link/${clean}` : 'link')
}

/** How an account bills its usage: a subscription bills the user's own plan (metered
 *  for visibility only), an api key / hanzo account bills via commerce. */
export type LinkKind = 'subscription' | 'apikey'
export type BillingMode = 'plan' | 'commerce'
export type LinkStatus = 'linked' | 'revoked'

export type LinkUsage = {
  sessionPct: number
  weeklyPct: number
  resetsAt?: string
  tokens: number
  inputTokens?: number
  outputTokens?: number
  spendCents: number
  currency?: string
  confidence?: string
  updatedAt?: string
}

export type Link = {
  id: string
  user: string
  machine: string
  host?: string
  os?: string
  provider: string
  account?: string
  plan?: string
  kind: LinkKind
  billing: BillingMode
  status: LinkStatus
  lastSeen?: string
  usage?: LinkUsage
  createdAt?: string
  updatedAt?: string
}

export type Device = {
  machine: string
  host?: string
  os?: string
  lastSeen?: string
  accounts: Link[]
  activeSessions: number
}

export type LinksList = { links: Link[]; devices: Device[] }

export type RouteCandidate = {
  provider: string
  account?: string
  plan?: string
  kind: LinkKind
  billing: BillingMode
  available: boolean
  headroomPct: number
  machine?: string
  host?: string
  linkId: string
  reason?: string
}

export type RoutePlan = { candidates: RouteCandidate[]; primary?: RouteCandidate; generatedAt?: string }

export type RevokeResult = { revoked: number; sessionsStopped: number }

// ── defensive normalizers ─────────────────────────────────────────────────────
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const kindOf = (v: unknown): LinkKind => (str(v) === 'apikey' ? 'apikey' : 'subscription')
const billingOf = (v: unknown): BillingMode => (str(v) === 'commerce' ? 'commerce' : 'plan')
const statusOf = (v: unknown): LinkStatus => (str(v) === 'revoked' ? 'revoked' : 'linked')

function normalizeUsage(v: unknown): LinkUsage | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = rec(v)
  return {
    sessionPct: num(o.sessionPct ?? o.session_pct),
    weeklyPct: num(o.weeklyPct ?? o.weekly_pct),
    resetsAt: str(o.resetsAt ?? o.resets_at) || undefined,
    tokens: num(o.tokens),
    inputTokens: o.inputTokens != null ? num(o.inputTokens) : undefined,
    outputTokens: o.outputTokens != null ? num(o.outputTokens) : undefined,
    spendCents: num(o.spendCents ?? o.spend_cents),
    currency: str(o.currency) || undefined,
    confidence: str(o.confidence) || undefined,
    updatedAt: str(o.updatedAt ?? o.updated_at) || undefined,
  }
}

export function normalizeLink(v: unknown): Link {
  const o = rec(v)
  return {
    id: str(o.id),
    user: str(o.user),
    machine: str(o.machine),
    host: str(o.host) || undefined,
    os: str(o.os) || undefined,
    provider: str(o.provider),
    account: str(o.account) || undefined,
    plan: str(o.plan) || undefined,
    kind: kindOf(o.kind),
    billing: billingOf(o.billing),
    status: statusOf(o.status),
    lastSeen: str(o.lastSeen ?? o.last_seen) || undefined,
    usage: normalizeUsage(o.usage),
    createdAt: str(o.createdAt ?? o.created_at) || undefined,
    updatedAt: str(o.updatedAt ?? o.updated_at) || undefined,
  }
}

function normalizeDevice(v: unknown): Device {
  const o = rec(v)
  return {
    machine: str(o.machine),
    host: str(o.host) || undefined,
    os: str(o.os) || undefined,
    lastSeen: str(o.lastSeen ?? o.last_seen) || undefined,
    accounts: arr(o.accounts).map(normalizeLink),
    activeSessions: num(o.activeSessions ?? o.active_sessions),
  }
}

function normalizeCandidate(v: unknown): RouteCandidate {
  const o = rec(v)
  return {
    provider: str(o.provider),
    account: str(o.account) || undefined,
    plan: str(o.plan) || undefined,
    kind: kindOf(o.kind),
    billing: billingOf(o.billing),
    available: o.available === true,
    headroomPct: num(o.headroomPct ?? o.headroom_pct),
    machine: str(o.machine) || undefined,
    host: str(o.host) || undefined,
    linkId: str(o.linkId ?? o.link_id),
    reason: str(o.reason) || undefined,
  }
}

export const LinksApi = {
  /** The caller's links + the per-machine device projection. */
  async list(): Promise<LinksList> {
    const o = rec(await restGet<unknown>(url('')))
    return { links: arr(o.links).map(normalizeLink), devices: arr(o.devices).map(normalizeDevice) }
  },
  /** The redundancy route plan across the caller's linked accounts. */
  async route(): Promise<RoutePlan> {
    const o = rec(await restGet<unknown>(url('route')))
    return {
      candidates: arr(o.candidates).map(normalizeCandidate),
      primary: o.primary ? normalizeCandidate(o.primary) : undefined,
      generatedAt: str(o.generatedAt ?? o.generated_at) || undefined,
    }
  },
  /** One device: its accounts + usage + active-session count. */
  async device(machine: string): Promise<Device> {
    return normalizeDevice(await restGet<unknown>(url(`devices/${encodeURIComponent(machine)}`)))
  },
  /** Log out one account (revoke + stop its sessions). */
  async revoke(id: string): Promise<void> {
    await restDelete(url(encodeURIComponent(id)))
  },
  /** Log out an entire device (revoke every account on it + stop its sessions). */
  async revokeDevice(machine: string): Promise<RevokeResult> {
    const o = rec(await restPost<unknown>(url(`devices/${encodeURIComponent(machine)}/revoke`)))
    return { revoked: num(o.revoked), sessionsStopped: num(o.sessionsStopped ?? o.sessions_stopped) }
  },
}
