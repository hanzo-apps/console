/**
 * Live cloud-credit balance — ONE reactive source shared by every surface that
 * shows the customer's money (sidebar, Wallet, Cost, …), so the number is the
 * SAME everywhere and tracks the real commerce ledger the gateway debits.
 *
 * Decomplected (Hickey): the balance is a VALUE that changes over time. This
 * module owns exactly one concern — holding that value and knowing WHEN to
 * refetch it — separated from WHO displays it (the components) and from HOW it
 * is fetched (`WalletApi.cloudBalance` → the per-tenant `/billing/balance`
 * proxy, server-scoped to the caller's own commerce subject).
 *
 * Liveness (the fix for "I don't see my balance change"):
 *  - refetch on mount,
 *  - refetch on window focus + tab-visibility (so returning from an external
 *    top-up portal — billing.hanzo.ai/Square — shows the new balance with no
 *    reload),
 *  - ONE ref-counted poll (default 30s) while a consumer is mounted AND the tab
 *    is visible,
 *  - `invalidateBalance()` after any balance-affecting action (a completion, a
 *    top-up) refetches immediately.
 *
 * A single in-flight request is de-duplicated and a short freshness window
 * collapses the mount/focus/poll bursts into one call, so N mounted consumers
 * cause ONE fetch, not N.
 *
 * Resilience (the fix for "billing spun forever / hammered a down endpoint during
 * a deploy blip"): the balance endpoint can return a transient 502/503/504 while
 * the commerce backend rolls. On ANY failed refetch the poll switches from the
 * steady 30s cadence to EXPONENTIAL BACKOFF (base 2s, doubling, capped at 60s)
 * with jitter, and the AUTOMATIC triggers (mount / focus / poll) are gated until
 * that window elapses — so a minutes-long outage costs a handful of attempts, not
 * hundreds. The breaker resets to the healthy cadence on the first success. A
 * USER-initiated retry (the Refresh button → `invalidateBalance`) or a
 * balance-affecting action always fires immediately (`bypassBackoff`), so a person
 * is never made to wait out the backoff. The happy-path 30s cadence is unchanged.
 */
import { useEffect, useSyncExternalStore } from 'react'

import { ApiError, WalletApi, type CloudBalance } from '~/lib/api/wallet'
import { usd } from '~/lib/money'

/** Lifecycle of the shared balance value. Mirrors the honest UI states. */
export type BalancePhase = 'idle' | 'loading' | 'ready' | 'noauth' | 'unconfigured' | 'error'

/** The immutable snapshot every consumer renders (stable ref between changes). */
export type BalanceSnapshot = {
  phase: BalancePhase
  /** The live balance, or null until the first successful load. */
  balance: CloudBalance | null
  /** Human error message when `phase === 'error'`. */
  error?: string
  /** ms epoch of the last settled fetch (0 = never). */
  updatedAt: number
}

/** How often to poll while mounted + visible (the healthy cadence). */
export const POLL_MS = 30_000
/** Collapse mount/focus/poll bursts: skip a non-forced refetch this fresh. */
const FRESH_MS = 4_000
/** First backoff step after a failure; doubles each consecutive failure. */
const BACKOFF_BASE_MS = 2_000
/** Backoff ceiling — a long outage settles to ~one attempt/min, never a tight loop. */
export const BACKOFF_CAP_MS = 60_000

let snapshot: BalanceSnapshot = { phase: 'idle', balance: null, updatedAt: 0 }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
let poller: ReturnType<typeof setTimeout> | null = null
let windowBound = false
/** Consecutive failed refetches (0 = healthy). Drives the backoff + the breaker. */
let failures = 0
/** ms epoch before which an AUTOMATIC refetch is gated (0 = no gate). Set on settle. */
let nextAttemptAt = 0

/**
 * Delay (ms) before the next AUTOMATIC balance refetch, from the consecutive
 * failure count. Healthy (0 failures) ⇒ the steady `POLL_MS` cadence. After a
 * failure ⇒ exponential backoff (base doubling per failure) capped at
 * `BACKOFF_CAP_MS`, with equal-jitter in `[exp/2, exp]` so N mounted tabs don't
 * retry in lockstep and re-hammer a recovering backend. Pure over `rand` (seedable
 * in tests). This IS the circuit breaker: it "opens" progressively on each failure
 * and holds at the cap, while the snapshot already carries the honest error state.
 */
export function backoffDelay(failed: number, rand: () => number = Math.random): number {
  if (failed <= 0) return POLL_MS
  const exp = Math.min(BACKOFF_BASE_MS * 2 ** (failed - 1), BACKOFF_CAP_MS)
  return Math.round(exp / 2 + rand() * (exp / 2))
}

function emit(): void {
  for (const l of listeners) l()
}

/** Replace the snapshot (new object ref ⇒ `useSyncExternalStore` re-renders). */
function set(next: Partial<BalanceSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  emit()
}

/** The current shared snapshot (stable reference until it changes). */
export function getBalanceSnapshot(): BalanceSnapshot {
  return snapshot
}

/** Spendable cents from a balance (available, falling back to total). */
export function spendableCents(b: CloudBalance | null): number | null {
  if (!b) return null
  if (typeof b.available === 'number') return b.available
  if (typeof b.balance === 'number') return b.balance
  return null
}

/**
 * Trial (non-cash credit) spendable cents, or null when commerce doesn't report the
 * bucket (legacy build) — the caller then shows only the combined total. Reads the
 * `trialBalance` alias, falling back to `creditsRemaining` (same value).
 */
export function trialCents(b: CloudBalance | null): number | null {
  if (!b) return null
  const t = b.trialBalance ?? b.creditsRemaining
  return typeof t === 'number' ? t : null
}

/**
 * Prepaid (real money) spendable cents, or null when the bucket is absent. Reads
 * `prepaidAvailable`, falling back to `prepaidBalance`.
 */
export function prepaidCents(b: CloudBalance | null): number | null {
  if (!b) return null
  const p = b.prepaidAvailable ?? b.prepaidBalance
  return typeof p === 'number' ? p : null
}

/**
 * "$5.00 trial + $12.00 credits" — the distinct trial/prepaid split for the wallet
 * surfaces, or null when NEITHER bucket is reported (the caller shows only the total,
 * never a fabricated split). The two fields land together, so once one is present the
 * other is treated as 0 rather than hiding the split.
 */
export function balanceSplitLabel(b: CloudBalance | null): string | null {
  const t = trialCents(b)
  const p = prepaidCents(b)
  if (t === null && p === null) return null
  return `${usd(t ?? 0)} trial + ${usd(p ?? 0)} credits`
}

/**
 * Fetch the balance through the `/billing/balance` proxy and publish it. A single
 * request is in-flight at a time; a non-forced call within `FRESH_MS` of the last
 * settle is a no-op (so mount + focus + poll collapse into one network call).
 *
 * `force` bypasses the freshness window (a poll/focus wants the newest value);
 * `bypassBackoff` bypasses the failure backoff gate (a USER retry or a
 * balance-affecting action must fire immediately). An automatic call (`force`
 * only) still waits out an open backoff window — that is what caps the retry
 * storm during an outage.
 */
export function refreshBalance(opts: { force?: boolean; bypassBackoff?: boolean } = {}): Promise<void> {
  if (inflight) return inflight
  const now = Date.now()
  if (!opts.force && snapshot.phase === 'ready' && now - snapshot.updatedAt < FRESH_MS) {
    return Promise.resolve()
  }
  // Backoff gate: after a failure the automatic triggers (mount/focus/poll) wait
  // out the exponential window instead of hammering a down backend. A user retry
  // or a balance-affecting action (`bypassBackoff`) always gets through.
  if (!opts.bypassBackoff && failures > 0 && now < nextAttemptAt) {
    return Promise.resolve()
  }
  // First-ever load shows a spinner; a refresh over existing data stays silent
  // (the last real number remains on screen until the new one lands — no flicker).
  if (snapshot.phase === 'idle') set({ phase: 'loading' })
  inflight = (async () => {
    try {
      // The subject arg is ignored by the proxy (server-resolved) — pass ''.
      const value = await WalletApi.cloudBalance('')
      failures = 0
      set({ phase: 'ready', balance: value, error: undefined, updatedAt: Date.now() })
    } catch (e) {
      failures += 1
      const code = e instanceof ApiError ? e.status : 0
      if (code === 401 || code === 403) set({ phase: 'noauth', balance: null, error: undefined, updatedAt: Date.now() })
      // 404 = balance endpoint not routed here; 501 = COMMERCE_TOKEN unset — both honest "not available".
      else if (code === 404 || code === 501) set({ phase: 'unconfigured', balance: null, error: undefined, updatedAt: Date.now() })
      else set({ phase: 'error', error: e instanceof Error ? e.message : 'the balance service did not answer', updatedAt: Date.now() })
    } finally {
      // Schedule the next automatic attempt: healthy ⇒ POLL_MS, failing ⇒ backoff.
      nextAttemptAt = Date.now() + backoffDelay(failures)
      inflight = null
    }
  })()
  return inflight
}

/**
 * A balance-affecting action just happened (a completion debit, a top-up credit)
 * — refetch now so the number moves without a reload, even if a backoff window is
 * open (an intentional action outranks the breaker). Fire-and-forget.
 */
export function invalidateBalance(): void {
  void refreshBalance({ force: true, bypassBackoff: true })
}

/** Refetch when the tab regains focus / becomes visible (guarded on subscribers). */
function onWake(): void {
  if (typeof document !== 'undefined' && document.hidden) return
  if (listeners.size === 0) return
  void refreshBalance({ force: true })
}

/** Bind window focus/visibility once (cheap; handlers gate on subscriber count). */
function bindWindow(): void {
  if (windowBound || typeof window === 'undefined') return
  windowBound = true
  window.addEventListener('focus', onWake)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onWake)
}

/**
 * The ONE poll engine: a self-scheduling timer whose delay tracks `nextAttemptAt`
 * — the steady `POLL_MS` while healthy, the backoff window while failing. (A fixed
 * `setInterval` cannot slow down, which is what let the old poll hammer a down
 * endpoint; a self-rescheduling timeout adapts.) Each tick refetches only when
 * visible + subscribed, awaits the settle so the NEXT delay reflects the fresh
 * failure count, then reschedules while a consumer is still mounted.
 */
function startPoll(): void {
  if (poller || typeof window === 'undefined') return
  const remaining = nextAttemptAt - Date.now()
  poller = setTimeout(() => void tickPoll(), remaining > 0 ? remaining : POLL_MS)
}

async function tickPoll(): Promise<void> {
  poller = null
  if (listeners.size === 0) return
  if (!(typeof document !== 'undefined' && document.hidden)) {
    await refreshBalance({ force: true })
  }
  if (listeners.size > 0) startPoll()
}

function stopPoll(): void {
  if (poller) {
    clearTimeout(poller)
    poller = null
  }
}

/** Subscribe to snapshot changes; wires liveness while ≥1 consumer is mounted. */
export function subscribeBalance(listener: () => void): () => void {
  listeners.add(listener)
  bindWindow()
  startPoll()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopPoll()
  }
}

/**
 * React binding: the live shared balance plus a `refresh()` (force a refetch now).
 * Subscribes to the store, kicks a mount refetch, and — through the store —
 * refetches on focus/visibility and on the shared poll. Every consumer that calls
 * this shows the SAME live number.
 */
export function useCloudBalance(): BalanceSnapshot & { refresh: () => void } {
  const snap = useSyncExternalStore(subscribeBalance, getBalanceSnapshot, getBalanceSnapshot)
  useEffect(() => {
    void refreshBalance()
  }, [])
  return { ...snap, refresh: invalidateBalance }
}

/** Test-only: reset the module singleton between suites. */
export function __resetBalanceStore(): void {
  snapshot = { phase: 'idle', balance: null, updatedAt: 0 }
  listeners.clear()
  inflight = null
  failures = 0
  nextAttemptAt = 0
  stopPoll()
}
