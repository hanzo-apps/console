/**
 * The Finance dashboard's transport — the seven reads `@hanzo/finance-ui` makes, each
 * pointed at the address that answers it.
 *
 * `/v1/finance` was a second spelling of one capability and it is gone. Balance and usage
 * are billing's OWN reads under another name; credits, invoices and payment-methods are
 * addresses commerce already serves under `/v1/billing`; the double-entry postings answer
 * at `/v1/billing/ledger`; and the reserve fund answers at `/v1/treasury`. Nothing was
 * aliased, so this file names the six new addresses and there is no seventh spelling.
 *
 * Repointing alone was not enough: three of them changed SHAPE, and a reader of the old
 * addresses re-parses as well as re-points. Each reshape below says which fact moved.
 *
 * The tenant boundary is unchanged: `/v1/billing/*` rides the console's own commerce
 * proxy, which pins the caller's billing subject onto `user`/`userId`/`customerId`
 * server-side — which is also how the credits read gets the `userId` commerce requires,
 * without the browser ever naming a subject. `/v1/treasury` rides the `/v1` bearer BFF.
 * Read-only; writes stay in the billing portal.
 */
import { httpFinanceClient, type FinanceClient } from '@hanzo/finance-ui'
import { dayKey, normalizeUsageRecords } from './aimetrics'
import { restGet, billingProxyV1Url, cloudProxyV1Url } from './client'

/** finance-ui's read name → the address that answers it. */
const ADDRESS: Record<string, string> = {
  balance: 'billing/balance',
  credits: 'billing/credits',
  usage: 'billing/usage',
  invoices: 'billing/invoices',
  'payment-methods': 'billing/methods',
  ledger: 'billing/ledger',
  treasury: 'treasury',
}

/** Build the same-origin URL for one finance read, with an optional query. */
export function financeUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const address = ADDRESS[path] ?? path
  let url = address.startsWith('billing/')
    ? billingProxyV1Url(address.slice('billing/'.length))
    : cloudProxyV1Url(address)
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
 * money surfaces serve either shape (commerce's own bytes on the raw routes, a bare body
 * on the typed ones), so we unwrap defensively before handing it to the shared normalizers.
 */
export function unwrapEnvelope(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>) && 'status' in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>).data
  }
  return body
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * `/v1/billing/balance` answers `{balance, holds, available, account}` in whole USD cents,
 * where the old address answered `{currency, availableCents, pendingCents, dueCents}`.
 * Same wallet, same number, different object: `holds` is what `pending` named, and a
 * prepaid wallet owes nothing, so `due` is 0.
 */
export function reshapeBalance(payload: unknown): unknown {
  const r = (payload ?? {}) as Record<string, unknown>
  return {
    currency: 'usd',
    availableCents: num(r.available),
    pendingCents: num(r.holds),
    dueCents: 0,
  }
}

/** `?range=` as a span in days — finance-ui's four windows. */
const DAYS: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }

/**
 * `/v1/billing/usage` answers ONE ROW PER BILLED CALL, where the old address answered a
 * rollup over `?range=`. The rollup is not lost, it just has no server that writes it, so
 * it is computed here from the SAME rows — read with the SAME normalizer the AI Metrics
 * page uses, never a second parse of the same wire.
 */
export function reshapeUsage(payload: unknown, range: unknown): unknown {
  const days = DAYS[String(range)] ?? 30
  const end = Date.now()
  const start = end - days * 86_400_000
  const rows = normalizeUsageRecords(payload).filter((r) => r.at != null && r.at >= start)

  const perDay = new Map<string, number>()
  const perProduct = new Map<string, { cents: number; units: number; tokens: number }>()
  let totalCents = 0
  for (const r of rows) {
    totalCents += r.cents
    const day = dayKey(r.at as number)
    perDay.set(day, (perDay.get(day) ?? 0) + r.cents)
    const label = r.product || r.model || 'Usage'
    const line = perProduct.get(label) ?? { cents: 0, units: 0, tokens: 0 }
    line.cents += r.cents
    line.units += 1
    line.tokens += r.totalTokens
    perProduct.set(label, line)
  }

  return {
    totalCents,
    currency: 'usd',
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    series: [...perDay].sort((a, b) => a[0].localeCompare(b[0])).map(([date, cents]) => ({ date, cents })),
    lines: [...perProduct]
      .sort((a, b) => b[1].cents - a[1].cents)
      .map(([label, l]) => ({ label, units: l.units, tokens: l.tokens, cents: l.cents })),
  }
}

async function transport(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
  const body = unwrapEnvelope(await restGet<unknown>(financeUrl(path, query)))
  if (path === 'balance') return reshapeBalance(body)
  if (path === 'usage') return reshapeUsage(body, query?.range)
  return body
}

/** The console-wired finance client — real per-org money reads at their own addresses. */
export const financeClient = (): FinanceClient => httpFinanceClient(transport)
