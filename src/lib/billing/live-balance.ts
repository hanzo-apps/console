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
 */
import { useEffect, useSyncExternalStore } from 'react'

import { ApiError, WalletApi, type CloudBalance } from '~/lib/api/wallet'

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

/** How often to poll while mounted + visible. */
const POLL_MS = 30_000
/** Collapse mount/focus/poll bursts: skip a non-forced refetch this fresh. */
const FRESH_MS = 4_000

let snapshot: BalanceSnapshot = { phase: 'idle', balance: null, updatedAt: 0 }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
let poller: ReturnType<typeof setInterval> | null = null
let windowBound = false

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
 * Fetch the balance through the `/billing/balance` proxy and publish it. A single
 * request is in-flight at a time; a non-forced call within `FRESH_MS` of the last
 * settle is a no-op (so mount + focus + poll collapse into one network call).
 */
export function refreshBalance(opts: { force?: boolean } = {}): Promise<void> {
  if (inflight) return inflight
  if (!opts.force && snapshot.phase === 'ready' && Date.now() - snapshot.updatedAt < FRESH_MS) {
    return Promise.resolve()
  }
  // First-ever load shows a spinner; a refresh over existing data stays silent
  // (the last real number remains on screen until the new one lands — no flicker).
  if (snapshot.phase === 'idle') set({ phase: 'loading' })
  inflight = (async () => {
    try {
      // The subject arg is ignored by the proxy (server-resolved) — pass ''.
      const value = await WalletApi.cloudBalance('')
      set({ phase: 'ready', balance: value, error: undefined, updatedAt: Date.now() })
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0
      if (code === 401 || code === 403) set({ phase: 'noauth', balance: null, error: undefined, updatedAt: Date.now() })
      // 404 = balance endpoint not routed here; 501 = COMMERCE_TOKEN unset — both honest "not available".
      else if (code === 404 || code === 501) set({ phase: 'unconfigured', balance: null, error: undefined, updatedAt: Date.now() })
      else set({ phase: 'error', error: e instanceof Error ? e.message : 'Failed to load balance', updatedAt: Date.now() })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * A balance-affecting action just happened (a completion debit, a top-up credit)
 * — refetch now so the number moves without a reload. Fire-and-forget.
 */
export function invalidateBalance(): void {
  void refreshBalance({ force: true })
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

function startPoll(): void {
  if (poller || typeof window === 'undefined') return
  poller = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    if (listeners.size === 0) return
    void refreshBalance({ force: true })
  }, POLL_MS)
}

function stopPoll(): void {
  if (poller) {
    clearInterval(poller)
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
  stopPoll()
}
