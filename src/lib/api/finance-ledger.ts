/**
 * Finance ledger — the signed-in tenant's per-org view of the unified ledger: credits,
 * invoices, payment methods, the double-entry ledger, and the treasury summary.
 *
 * This is a thin transport: the SHARED `@hanzo/finance-ui` owns the data contract, the
 * optional-safe normalizers, and the components — the SAME package finance.hanzo.ai
 * renders — so a credits/invoices card is identical in both surfaces. Here we only
 * inject console's transport: every read goes through the console's OWN `/v1`
 * user-bearer proxy, which mints a short-lived user token and forwards to cloud with
 * the org resolved from the Bearer owner. A cookie-only bare `/v1/*` would 403 on the
 * live ingress, so the explicit `/v1` address is load-bearing. `billing` and `treasury`
 * are allow-listed in `proxy-allow.ts` CLOUD_HEADS. Read-only; writes stay in the
 * billing portal.
 */
import { httpFinanceClient, type FinanceClient } from '@hanzo/finance-ui'
import { ApiError, restGet, cloudProxyV1Url } from './client'

/**
 * Where each finance read lives (HIP-0139): the ledger reads sit under `/v1/billing`,
 * the reserve summary under `/v1/treasury`.
 *
 * `balance` and `usage` are absent on purpose. Billing serves reads by those names but
 * they answer a DIFFERENT question in a different shape, and a card showing the wrong
 * number is worse than a card showing none — so they have no address here and the
 * dashboard renders its honest state for those two.
 */
const ADDRESS: Record<string, string> = {
  credits: 'billing/credits',
  invoices: 'billing/invoices',
  ledger: 'billing/ledger',
  'payment-methods': 'billing/methods',
  treasury: 'treasury',
}

/** Build the console proxy URL for one finance read, with an optional query. */
export function financeUrl(head: string, query?: Record<string, string | number | undefined>): string {
  const address = ADDRESS[head]
  if (!address) throw new ApiError(`Finance serves no "${head}" read.`, 404)
  let url = cloudProxyV1Url(address)
  if (query) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v))
    const s = qs.toString()
    if (s) url += `?${s}`
  }
  return url
}

/**
 * Unwrap a casibase `{ status, msg, data }` envelope; pass a bare payload through. The
 * backend may serve either shape (like commerce vs the casibase surfaces), so we unwrap
 * defensively before handing the payload to the shared normalizers.
 */
export function unwrapEnvelope(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>) && 'status' in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>).data
  }
  return body
}

async function transport(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
  const body = await restGet<unknown>(financeUrl(path, query))
  return unwrapEnvelope(body)
}

/** The console-wired finance client — real per-org reads over the `/v1` bearer proxy. */
export const financeClient = (): FinanceClient => httpFinanceClient(transport)
