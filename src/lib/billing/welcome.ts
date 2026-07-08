'use client'

/**
 * Welcome-grant self-heal — claim the org's one-time $5 trial credit on first
 * authenticated load, AT MOST ONCE per browser session per org.
 *
 * The signup BFF grants the credit server-side, but a SOCIAL-login user (who never
 * hits that route) and any pre-existing $0 account would otherwise sit at a paywall.
 * So the session bootstrap fires the idempotent `BillingApi.welcome()` once — the
 * grant lands at most once per subject server-side regardless, this guard just avoids
 * re-POSTing on every reload. Best-effort: any failure is swallowed (a later session
 * retries), and the shared balance is refreshed only when a grant actually lands.
 */
import { BillingApi } from '~/lib/api/billing'
import { IS_EMBED } from '~/lib/embed'
import { invalidateBalance } from './live-balance'

/** In-memory guard (once per page lifetime). */
const claimed = new Set<string>()
/** Persistent guard key (once per tab session, survives reloads). */
const SS_PREFIX = 'hz_welcome_claimed:'

/**
 * Fire the welcome-grant for `owner` (the org slug) exactly once per browser session.
 * No-op on the server, for an empty owner, or when already claimed this session.
 */
export function claimWelcomeGrantOnce(owner: string): void {
  if (!owner || typeof window === 'undefined') return
  // The welcome-grant proxy (POST /billing/v1/me/welcome) is a BFF-only route with no
  // handler in the static embed (→ 405). Skip it here; the embed's welcome grant is
  // handled server-side at signup (self-heal via /v1 is tracked separately).
  if (IS_EMBED) return
  if (claimed.has(owner)) return
  const key = SS_PREFIX + owner
  try {
    if (sessionStorage.getItem(key)) {
      claimed.add(owner)
      return
    }
  } catch {
    /* sessionStorage may be unavailable (privacy mode) — fall through to the in-memory guard */
  }
  claimed.add(owner)
  void BillingApi.welcome()
    .then((r) => {
      if (r?.granted) invalidateBalance()
    })
    .catch(() => {
      /* best-effort; the grant is idempotent so a later session retries */
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
export function __resetWelcomeGuard(): void {
  claimed.clear()
}
