/**
 * Waitlist access — the server-side client + policy for WAITLISTED PRODUCT ACCESS.
 *
 * THE MODEL (post public-launch). Signup is OPEN: anyone creates an account (see
 * `/auth/signup`). What is gated is PRODUCT ACCESS — a signed-in user holds an
 * account plus a WAITLIST POSITION, and reaches the product (console / chat / app)
 * when they cross the front of the line. Two ways to move up, both server-attested:
 *   1. REFERRALS — someone who joins with your refCode raises your position
 *      (`referralCount`, owned by the waitlist plugin's join flow).
 *   2. CONTRIBUTE COMPUTE — running a `hanzod` node earns a big boost / instant
 *      access (a service-attested `POST /v1/waitlist/boost`, source=`hanzod`).
 *
 * ONE SOURCE OF TRUTH. Position + access live in the waitlist Base plugin
 * (`/v1/waitlist/*`), so console, chat and app all read the SAME status for a user
 * by email — one waitlist everywhere, no per-surface copy. This module is the
 * console's server-side adapter to it.
 *
 * RE-GATABLE, FAIL-OPEN. The gate is ACTIVE only when `WAITLIST_URL` is set; the
 * capacity/open master switches (`WAITLIST_ACCESS_CAPACITY`, `WAITLIST_OPEN`) live
 * on the plugin. When the waitlist is unconfigured OR the plugin is unreachable,
 * `waitlistAccess` FAILS OPEN (grants access) — a waitlist blip must never lock
 * paying users out of the product. Enforcement is additive, never a hard dependency.
 */
import { brandFromHost } from '~/config'
import { fetchWithTimeout } from './fetch-timeout'

const trim = (s: string) => s.replace(/\/+$/, '')

/** Base process that mounts the waitlist plugin (`/v1/waitlist/*`). Unset → gate off. */
const WAITLIST_URL = trim((process.env.WAITLIST_URL ?? '').trim())
/** Service secret (KMS) for service-authed join/boost — bypasses the public captcha/
 *  rate-limit path (the console has already run its own protections on signup). */
const ADMIN_SECRET = (process.env.WAITLIST_ADMIN_SECRET ?? '').trim()
/** Explicit slug override; default is the request's brand (hanzo/lux/zoo/pars). */
const SLUG_OVERRIDE = (process.env.WAITLIST_SLUG ?? '').trim()

/** True when product-access gating is wired on this deployment. */
export const waitlistConfigured = (): boolean => WAITLIST_URL !== ''

/** The waitlist slug for a request host (brand-scoped, one waitlist per brand). */
function slugFor(host?: string | null): string {
  return SLUG_OVERRIDE || brandFromHost(host)
}

/** The normalized status the console reads (a projection of the plugin response). */
export type WaitlistStatus = {
  hasAccess: boolean
  rank: number
  total: number
  aheadOf: number
  referralCount: number
  score: number
  boost: number
  refCode: string
  /** Effective when the gate is off / unconfigured — the caller treats it as open. */
  open: boolean
}

type PluginStatus = {
  ok?: boolean
  rank?: number
  total?: number
  aheadOf?: number
  referralCount?: number
  score?: number
  boost?: number
  refCode?: string
  hasAccess?: boolean
  open?: boolean
}

function project(j: PluginStatus): WaitlistStatus {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    hasAccess: j.hasAccess === true,
    rank: n(j.rank),
    total: n(j.total),
    aheadOf: n(j.aheadOf),
    referralCount: n(j.referralCount),
    score: n(j.score),
    boost: n(j.boost),
    refCode: typeof j.refCode === 'string' ? j.refCode : '',
    open: j.open === true,
  }
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (ADMIN_SECRET) h.Authorization = `Bearer ${ADMIN_SECRET}`
  return h
}

/**
 * Join `email` to the brand waitlist (idempotent; the plugin returns the existing
 * entry on a repeat). Service-authed, so the plugin skips the public captcha/
 * rate-limit/disposable checks — the console already ran its own on signup. Best-
 * effort: returns null (never throws) on any failure, so it never blocks signup.
 */
export async function joinWaitlist(
  email: string,
  opts: { host?: string | null; referrerCode?: string } = {},
): Promise<WaitlistStatus | null> {
  if (!waitlistConfigured()) return null
  try {
    const res = await fetchWithTimeout(`${WAITLIST_URL}/v1/waitlist/join`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        waitlist: slugFor(opts.host),
        email,
        referrerCode: (opts.referrerCode ?? '').trim() || undefined,
      }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return project(((await res.json().catch(() => ({}))) as PluginStatus) ?? {})
  } catch {
    return null
  }
}

/**
 * The waitlist status for `email` (rank, referrals, access). On a first-seen user
 * (no entry — e.g. a social-login account that never hit `/auth/signup`) this AUTO-
 * JOINS so every signed-in user has a position. Returns null on any hard failure.
 */
export async function waitlistStatus(
  email: string,
  host?: string | null,
): Promise<WaitlistStatus | null> {
  if (!waitlistConfigured() || !email) return null
  const url = `${WAITLIST_URL}/v1/waitlist/status?waitlist=${encodeURIComponent(slugFor(host))}&email=${encodeURIComponent(email)}`
  try {
    const res = await fetchWithTimeout(url, { headers: authHeaders(), cache: 'no-store' })
    if (res.status === 404) return joinWaitlist(email, { host })
    if (!res.ok) return null
    return project(((await res.json().catch(() => ({}))) as PluginStatus) ?? {})
  } catch {
    return null
  }
}

/**
 * THE shared access decision for a signed-in user. FAIL-OPEN: when the waitlist is
 * unconfigured or unreachable, grants access (a waitlist blip never locks the
 * product). When configured and reachable, returns the plugin's `hasAccess` verdict
 * plus the status for the gate UI to render position + move-up mechanics.
 */
export async function waitlistAccess(
  email: string,
  host?: string | null,
): Promise<{ hasAccess: boolean; status: WaitlistStatus | null }> {
  if (!waitlistConfigured()) return { hasAccess: true, status: null }
  const status = await waitlistStatus(email, host)
  // Null status = the plugin was unreachable/errored → fail OPEN. A real closed
  // verdict comes back as a concrete status with hasAccess:false.
  if (!status) return { hasAccess: true, status: null }
  return { hasAccess: status.hasAccess || status.open, status }
}

/**
 * Record a service-attested boost for a user (the hanzod-contribution + admin-grant
 * hook). `source` is the attested origin; `grantAccess` flips instant access (a
 * hanzod node earns the front of the line). Service-authed only. Best-effort.
 *
 * WIRING NOTE: the hanzod node-registration flow calls this with source=`hanzod`
 * once a node attests to the account. The node-side cryptographic attestation
 * (proving the node truly belongs to the account, idempotent by node nonce) is the
 * remaining piece — this is the account-side hook it lands on.
 */
export async function boostWaitlist(
  email: string,
  opts: { host?: string | null; source: 'hanzod' | 'referral' | 'share' | 'grant'; amount?: number; grantAccess?: boolean },
): Promise<boolean> {
  if (!waitlistConfigured() || !ADMIN_SECRET) return false
  try {
    const res = await fetchWithTimeout(`${WAITLIST_URL}/v1/waitlist/boost`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        waitlist: slugFor(opts.host),
        email,
        source: opts.source,
        amount: opts.amount,
        grantAccess: opts.grantAccess,
      }),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}
