/**
 * Finance ledger — the signed-in tenant's per-org view of the unified finance ledger
 * (hanzoai/finance, embedded in cloud): balance, credits, metered usage, invoices,
 * payment methods, the double-entry ledger, and the treasury summary.
 *
 * This is a thin transport: the SHARED `@hanzo/finance-ui` owns the data contract, the
 * optional-safe normalizers, and the components — the SAME package finance.hanzo.ai
 * renders — so a spend/usage/credits card is identical in both surfaces. Here we only
 * inject console's transport: every read goes through the console's OWN `/v1`
 * user-bearer proxy (`<origin>/v1/finance/*`), which mints a short-lived user
 * token and forwards to cloud with the org resolved from the Bearer owner. A cookie-only
 * bare `/v1/finance/*` would 403 on the live ingress (same class as platform/analytics),
 * so the explicit `/v1` address is load-bearing. `finance` is allow-listed in
 * `proxy-allow.ts` CLOUD_HEADS. Read-only; writes stay in the billing portal.
 */
import { httpFinanceClient, type FinanceClient } from '@hanzo/finance-ui'
import { restGet, cloudProxyV1Url } from './client'

/** Build the console `/v1/finance/<path>` proxy URL with an optional query. */
export function financeUrl(path: string, query?: Record<string, string | number | undefined>): string {
  let url = cloudProxyV1Url(`finance/${path}`)
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
 * finance backend may serve either shape (like commerce vs the casibase surfaces), so
 * we unwrap defensively before handing the payload to the shared normalizers.
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

/** The console-wired finance client — real per-org `/v1/finance/*` reads over the `/v1` proxy. */
export const financeClient = (): FinanceClient => httpFinanceClient(transport)
