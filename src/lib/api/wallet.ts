/**
 * Wallet client — the user's cloud credit balance.
 *
 * One call, grounded against what is actually deployed: `cloudBalance` reads the
 * real commerce endpoint `GET /v1/billing/balance` (verified live: 401 without a
 * session, `{balance,holds,available}` with one). It goes through the same
 * cookie-credentialed `/v1` transport as the rest of the console (the ingress
 * proxies `/v1` to the gateway, which validates the session and scopes by the
 * JWT — so identity is server-side; `user` is a hint).
 */
import { ApiError, restGet, billingProxyV1Url } from './client'

/**
 * Money balance in USD cents (commerce shape). The `balance`/`holds`/`available`
 * triple is the COMBINED wallet; the split fields below break it into the two buckets
 * commerce now returns — `trial` (non-cash welcome/starter/comp credit) and `prepaid`
 * (real money) — so a surface can show "$5.00 trial + $X.XX credits". Spend draws
 * trial-first (enforced server-side). All split fields are OPTIONAL: a legacy commerce
 * build omits them and the surface degrades to the combined total (never fabricated).
 */
export type CloudBalance = {
  /** Total balance, cents (trial + prepaid). */
  balance: number
  /** Funds on hold, cents. */
  holds: number
  /** Spendable now, cents (trial + prepaid available). */
  available: number
  /** Trial (non-cash credit) granted lifetime, cents. Alias of `creditsGranted`. */
  trialGranted?: number
  /** Trial (non-cash credit) remaining/spendable, cents. Alias of `creditsRemaining`. */
  trialBalance?: number
  /** Non-cash credit granted lifetime, cents. */
  creditsGranted?: number
  /** Non-cash credit remaining, cents. */
  creditsRemaining?: number
  /** Prepaid (real money) total, cents. */
  prepaidBalance?: number
  /** Prepaid (real money) spendable now, cents. */
  prepaidAvailable?: number
}

export const WalletApi = {
  /**
   * The user's cloud credit balance (USD cents). `currency` defaults to `usd`
   * (the credit ledger currency); crypto deposits settle into the same USD ledger.
   */
  cloudBalance: (_user: string, currency = 'usd'): Promise<CloudBalance> =>
    // Same-origin `/v1/billing/*` server proxy (app/v1/billing/[...path]) injects the
    // commerce service token + scopes to the caller's OWN org server-side. The
    // `user` subject is server-resolved (the arg is ignored — the browser cannot
    // read another tenant's ledger), so only `currency` is forwarded.
    restGet<CloudBalance>(`${billingProxyV1Url('balance')}?currency=${encodeURIComponent(currency)}`),
}

export { ApiError }
