/**
 * Wallet / HUSD top-up client.
 *
 * Two calls, both grounded against what is actually deployed:
 *
 *  • `cloudBalance` — the user's cloud credit balance, in USD cents, from the
 *    real commerce endpoint `GET /v1/billing/balance` (verified live: 401 without
 *    a session, `{balance,holds,available}` with one). Goes through the same
 *    cookie-credentialed `/v1` transport as the rest of the console (the ingress
 *    proxies `/v1` to the gateway, which validates the session and scopes by the
 *    JWT — so identity is server-side; `user` is a hint).
 *
 *  • `recordWalletTopup` — posts a sent HUSD transaction to the console's OWN
 *    same-origin top-up endpoint (`POST /billing/topup/wallet`, a server route
 *    handler — billing.hanzo.ai is a static export and cannot host a runtime
 *    POST, and the commerce backend is off-limits, so the verify-and-record seam
 *    lives here, mirroring the `/paas` proxy pattern). The handler verifies the
 *    HUSD transfer on-chain, then records it to commerce as a `husd` crypto
 *    payment and returns the credited amount + new balance.
 */
import { ApiError, restGet, restPost, v1Url, billingProxyV1Url } from './client'

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

/** A wallet HUSD top-up to verify + record. Amount is read from-chain, not trusted. */
export type WalletTopupRequest = {
  /** Hash of the HUSD transfer the wallet already sent. */
  txHash: string
  /** Address that sent it (the connected wallet). */
  fromAddress: string
  /** User to credit; omitted ⇒ the session's own user (server-derived). */
  userId?: string
}

/** Result of recording a verified HUSD top-up. */
export type WalletTopupResult = {
  /** Cents credited (from the verified on-chain HUSD amount). */
  creditedCents: number
  /** New balance after crediting, cents. */
  balance: number
  /** The recorded transaction hash. */
  txHash: string
  /** Payment status from commerce (e.g. 'paid', 'credit'). */
  status: string
}

export const WalletApi = {
  /**
   * The user's cloud credit balance (USD cents). `currency` defaults to `usd`
   * (the credit ledger currency); HUSD top-ups settle into the same USD ledger.
   */
  cloudBalance: (_user: string, currency = 'usd'): Promise<CloudBalance> =>
    // Same-origin `/v1/billing/*` server proxy (app/v1/billing/[...path]) injects the
    // commerce service token + scopes to the caller's OWN org server-side. The
    // `user` subject is server-resolved (the arg is ignored — the browser cannot
    // read another tenant's ledger), so only `currency` is forwarded.
    restGet<CloudBalance>(`${billingProxyV1Url('balance')}?currency=${encodeURIComponent(currency)}`),

  /**
   * Verify a sent HUSD transfer and credit the user's balance, via the cloud
   * console subsystem's same-origin `/v1/commerce/topup/wallet` (task #41). The
   * server reads the receipt on-chain, credits the VALIDATED caller's own org for
   * the on-chain amount (never a client number), and records it to commerce.
   */
  recordWalletTopup: (req: WalletTopupRequest): Promise<WalletTopupResult> =>
    restPost<WalletTopupResult>(v1Url('commerce/topup/wallet'), req),
}

export { ApiError }
