'use client'

/**
 * Affiliate capture + attribute — the console half of the partner-commission loop
 * (orthogonal to the referral `?ref` capture; a new org can be BOTH referred and
 * affiliate-attributed, distinct economic relationships).
 *
 *  1. `stashAffiliateCode()` captures an `?aff=<code>` off the CURRENT URL into
 *     localStorage (call it on load, before auth). An affiliate link is
 *     `https://<brand>/?aff=<code>`; stashing it lets the code survive the OAuth
 *     round-trip.
 *  2. `attributeAffiliateOnce(owner)` POSTs `/v1/affiliates/attribute {code}` AT MOST
 *     ONCE per browser session per org, right after the user first becomes
 *     authenticated — the referred org (the caller) is bound to the affiliate
 *     server-side. Best-effort + server-idempotent (a dup / self / unknown / un-approved
 *     code is a harmless no-op or 4xx), so it never blocks or perturbs the session
 *     bootstrap.
 */
import { AffiliatesApi } from '~/lib/api/affiliates'

/** localStorage key for a captured affiliate code (survives the OAuth redirect). */
const LS_AFF = 'hz_aff'
/** In-memory guard (once per page lifetime). */
const attributed = new Set<string>()
/** Persistent per-session guard so we don't re-POST on every reload. */
const SS_PREFIX = 'hz_aff_attributed:'

/**
 * Capture an `?aff=<code>` from the current URL into localStorage. No-op on the
 * server or when there is no `aff` param. Safe to call on every load (idempotent).
 */
export function stashAffiliateCode(): void {
  if (typeof window === 'undefined') return
  try {
    const aff = new URLSearchParams(window.location.search).get('aff')
    const code = (aff ?? '').trim()
    if (code) localStorage.setItem(LS_AFF, code)
  } catch {
    /* URL/localStorage may be unavailable — nothing to capture */
  }
}

/**
 * Attribute a stashed affiliate code for `owner` (the newly-authenticated org)
 * exactly once per browser session. No-op with no stashed code, on the server, or
 * when already attributed this session. On success the code is consumed (removed);
 * on a transient failure it is kept so a later session retries (the server is
 * idempotent).
 */
export function attributeAffiliateOnce(owner: string): void {
  if (!owner || typeof window === 'undefined') return
  if (attributed.has(owner)) return

  let code = ''
  try {
    code = (localStorage.getItem(LS_AFF) ?? '').trim()
  } catch {
    /* ignore */
  }
  if (!code) {
    attributed.add(owner)
    return // nothing stashed — this user did not arrive via an affiliate link
  }

  const key = SS_PREFIX + owner
  try {
    if (sessionStorage.getItem(key)) {
      attributed.add(owner)
      return
    }
  } catch {
    /* sessionStorage unavailable — fall through to the in-memory guard */
  }
  attributed.add(owner)

  void AffiliatesApi.attribute(code)
    .then(() => {
      // Consumed — a referred org is bound to at most one affiliate, ever (first-touch).
      try {
        localStorage.removeItem(LS_AFF)
      } catch {
        /* ignore */
      }
    })
    .catch(() => {
      /* best-effort; server-idempotent (dup/self/unknown/un-approved are no-ops or 4xx) */
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
export function __resetAffiliateGuard(): void {
  attributed.clear()
}
