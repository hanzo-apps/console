'use client'

/**
 * Active resource scope — the { project, environment } every cloud call is
 * scoped to, WITHIN the active org.
 *
 * Orthogonal to org scope: the org (`X-Org-Id`) is owned by `lib/org-scope.ts`
 * (`currentOrg()`), switchable by a global admin. THIS module owns the next two
 * levels down — the project and the environment — so the three compose into one
 * tenant path (org → project → environment) without either layer knowing the
 * other's internals.
 *
 * Held in module state (not React state) so the non-React `request()` in
 * lib/api/client.ts can read it synchronously when stamping headers. The
 * Scope keeps this module state in sync with the user's selection and
 * localStorage.
 *
 * - **project** is user-selected; `undefined` means org-level (no project scope).
 * - **environment** defaults to `mainnet`. Every project INTRINSICALLY has
 *   mainnet / testnet / devnet (bound to the Hanzo network tiers) plus any custom
 *   environments the user creates.
 */

/** The three environments every project intrinsically has, bound to network tiers. */
export const STOCK_ENVIRONMENTS = ['mainnet', 'testnet', 'devnet'] as const
export type StockEnvironment = (typeof STOCK_ENVIRONMENTS)[number]

export type Scope = {
  /** undefined = org-level (no project scoping). */
  project?: string
  /** stock (mainnet/testnet/devnet) or a custom environment name. */
  environment: string
}

export const DEFAULT_ENVIRONMENT: StockEnvironment = 'mainnet'
const LS_KEY = 'hanzo.console.scope'

let active: Scope = { environment: DEFAULT_ENVIRONMENT }

/** Read the active { project, environment } (sync — used to stamp headers). */
export const getScope = (): Scope => active

/** Merge into the active scope. */
export const setScope = (next: Partial<Scope>): Scope => {
  active = { ...active, ...next }
  return active
}

/** Restore the persisted { project, environment }. */
export const loadPersistedScope = (): Partial<Scope> | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Partial<Scope>) : null
  } catch {
    return null
  }
}

/** Persist the current { project, environment } selection. */
export const persistScope = (s: Scope): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ project: s.project, environment: s.environment }))
  } catch {
    // ignore quota / private-mode failures — scope still lives in module state
  }
}
