'use client'

/**
 * Referral capture + claim — the console half of the viral loop.
 *
 *  1. `stashReferralCode()` captures a `?ref=<code>` off the CURRENT URL into
 *     localStorage (call it on load, before auth). A referral link is
 *     `https://<brand>/?ref=<code>`; when the visitor lands on the console with
 *     that query the code is stashed so it survives the OAuth round-trip.
 *  2. `claimReferralOnce(owner)` POSTs `/v1/referrals/claim {code}` AT MOST ONCE per
 *     browser session per org, right after the user first becomes authenticated —
 *     the referee (the caller) is bound to the referrer server-side. Best-effort +
 *     server-idempotent (a dup / self-referral / unknown code is a harmless no-op
 *     or 4xx), so it never blocks or perturbs the session bootstrap.
 */
import { ReferralsApi } from '~/lib/api/referrals'

/** localStorage key for a captured referral code (survives the OAuth redirect). */
const LS_REF = 'hz_ref'
/** In-memory guard (once per page lifetime). */
const claimed = new Set<string>()
/** Persistent per-session guard so we don't re-POST on every reload. */
const SS_PREFIX = 'hz_ref_claimed:'

/**
 * Capture a `?ref=<code>` from the current URL into localStorage. No-op on the
 * server or when there is no `ref` param. Safe to call on every load (idempotent).
 */
export function stashReferralCode(): void {
  if (typeof window === 'undefined') return
  try {
    const ref = new URLSearchParams(window.location.search).get('ref')
    const code = (ref ?? '').trim()
    if (code) localStorage.setItem(LS_REF, code)
  } catch {
    /* URL/localStorage may be unavailable — nothing to capture */
  }
}

/**
 * Claim a stashed referral for `owner` (the newly-authenticated org) exactly once
 * per browser session. No-op with no stashed code, on the server, or when already
 * claimed this session. On success the code is consumed (removed); on a transient
 * failure it is kept so a later session retries (the server is idempotent).
 */
export function claimReferralOnce(owner: string): void {
  if (!owner || typeof window === 'undefined') return
  if (claimed.has(owner)) return

  let code = ''
  try {
    code = (localStorage.getItem(LS_REF) ?? '').trim()
  } catch {
    /* ignore */
  }
  if (!code) {
    claimed.add(owner)
    return // nothing stashed — this user did not arrive via a referral link
  }

  const key = SS_PREFIX + owner
  try {
    if (sessionStorage.getItem(key)) {
      claimed.add(owner)
      return
    }
  } catch {
    /* sessionStorage unavailable — fall through to the in-memory guard */
  }
  claimed.add(owner)

  void ReferralsApi.claim(code)
    .then(() => {
      // Consumed — a referee is bound at most once, ever (first-touch).
      try {
        localStorage.removeItem(LS_REF)
      } catch {
        /* ignore */
      }
    })
    .catch(() => {
      /* best-effort; server-idempotent (dup/self/unknown are no-ops or 4xx) */
    })
    .finally(() => {
      try {
        sessionStorage.setItem(key, '1')
      } catch {
        /* ignore */
      }
    })
}

/** Test-only: reset the in-memory guard between suites. */
export function __resetReferralGuard(): void {
  claimed.clear()
}
