/**
 * Square Web Payments SDK — the ONLY card-entry path in the console.
 *
 * PCI posture: the card number / CVV / expiry are entered into Square's own
 * cross-origin iframe (served from *.squarecdn.com) and tokenized IN THE
 * BROWSER by Square. The console (and our servers, and our logs) only ever see
 * the resulting opaque single-use nonce (`token`) — never a PAN. This keeps the
 * card top-up in PCI SAQ-A scope.
 *
 * This module is pure + side-effect-isolated: the typed SDK surface, the
 * env→CDN-URL map, and the amount validators are pure (unit-tested); the one
 * effect (`loadSquareSdk`) is an idempotent, per-env memoized script loader.
 */

/** The subset of the Web Payments SDK the top-up flow uses (strict-typed). */
export interface SquareTokenResult {
  status: string // 'OK' | 'INVALID' | 'ABORT' | ...
  token?: string // the single-use payment nonce (sourceId) on status OK
  errors?: Array<{ message?: string; field?: string; type?: string }>
}
export interface SquareCard {
  attach(el: HTMLElement | string): Promise<void>
  tokenize(): Promise<SquareTokenResult>
  destroy(): Promise<void>
}
export interface SquarePayments {
  card(options?: Record<string, unknown>): Promise<SquareCard>
}
export interface SquareSdk {
  payments(applicationId: string, locationId: string): SquarePayments
}

declare global {
  interface Window {
    Square?: SquareSdk
  }
}

export type SquareEnv = 'sandbox' | 'production'

/**
 * The Web Payments SDK CDN URL for an environment. Fail-safe: anything that is
 * not an explicit "production" loads the SANDBOX SDK — a misconfigured env can
 * never point a real card form at the live tokenizer by accident (mirrors the
 * server's fail-closed SQUARE_ENVIRONMENT authority).
 */
export function squareSdkUrl(environment: string): string {
  return environment === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js'
}

/** True iff this environment charges REAL money (drives the sandbox badge). */
export function isLiveSquareEnv(environment: string): boolean {
  return environment === 'production'
}

// ── Amount validation (pure) ────────────────────────────────────────────────

/** Quick-pick top-up amounts, in whole dollars. */
export const PRESET_TOPUP_USD = [10, 25, 50, 100] as const

/** $1 minimum (Square rejects sub-dollar card charges; also a sane floor). */
export const MIN_TOPUP_CENTS = 100
/** $5,000 per-top-up ceiling — a self-service guard against fat-finger charges. */
export const MAX_TOPUP_CENTS = 500_000

/**
 * Parse a user-typed dollar amount → integer cents, or null when it is not a
 * clean positive money value. Accepts "25", "25.5", "$25.00", " 25 "; rejects
 * "", "abc", "-5", "1.234" (sub-cent precision).
 */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const cents = Math.round(Number(cleaned) * 100)
  if (!Number.isFinite(cents) || cents <= 0) return null
  return cents
}

/**
 * Validate a top-up amount in cents. Returns a human error string, or null when
 * the amount is chargeable. Kept separate from parsing so the UI can validate a
 * preset-selected cents value without a string round-trip.
 */
export function validateTopupCents(cents: number): string | null {
  if (!Number.isInteger(cents) || cents <= 0) return 'Enter a valid amount.'
  if (cents < MIN_TOPUP_CENTS) return `Minimum top-up is $${(MIN_TOPUP_CENTS / 100).toFixed(0)}.`
  if (cents > MAX_TOPUP_CENTS) return `Maximum top-up is $${(MAX_TOPUP_CENTS / 100).toLocaleString()}.`
  return null
}

// ── SDK loader (the one effect) ─────────────────────────────────────────────

const loaders = new Map<string, Promise<SquareSdk>>()

/**
 * Load the Web Payments SDK for `environment` exactly once per environment and
 * resolve with `window.Square`. Idempotent (concurrent callers share the same
 * promise); rejects on network/parse failure or when the script loads but does
 * not expose `window.Square`. Client-only.
 */
export function loadSquareSdk(environment: string): Promise<SquareSdk> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Square SDK can only load in the browser'))
  }
  if (window.Square) return Promise.resolve(window.Square)

  const url = squareSdkUrl(environment)
  const cached = loaders.get(url)
  if (cached) return cached

  const p = new Promise<SquareSdk>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`)
    const onReady = () => {
      if (window.Square) resolve(window.Square)
      else reject(new Error('Square SDK loaded but window.Square is undefined'))
    }
    if (existing) {
      if (window.Square) resolve(window.Square)
      else {
        existing.addEventListener('load', onReady, { once: true })
        existing.addEventListener('error', () => reject(new Error('Failed to load Square SDK')), { once: true })
      }
      return
    }
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.addEventListener('load', onReady, { once: true })
    script.addEventListener('error', () => {
      loaders.delete(url) // allow a later retry after a transient network error
      reject(new Error('Failed to load Square SDK'))
    }, { once: true })
    document.head.appendChild(script)
  })
  loaders.set(url, p)
  return p
}
