/**
 * What each figure on the home shows — a number, or an em dash and the reason there
 * is no number. Pure, so the rule this screen must never break is proved without a
 * DOM: a dash means UNKNOWN. It is never a zero (a real zero prints as `0`), and
 * never a reading we took and failed to use — a failed or unreported source prints
 * its reason on the tile.
 *
 * Both sources are the ones the neighbouring screens already read: the shared live
 * balance (`useCloudBalance` — the same value the sidebar wallet prints) and the one
 * usage roll-up (`GET /v1/usage/summary` — what /usage renders). So the home cannot
 * disagree with the header beside it or the page behind it, and month-to-date gains
 * no fourth reader.
 */
import type { BackendState } from '@hanzo/ui/product'

import type { TileView } from '~/components/products/billing/logic'
import type { BalancePhase } from '~/lib/billing/live-balance'
import type { UsageRange, UsageSummary } from '~/lib/api/usage-summary'

/** A figure and the line under it. `value: null` is the em dash — never a zero. */
export type Reading = { value: string | null; sub: string }

/** The window the home reads. One constant, so the fetch and the caption cannot drift. */
export const RANGE: UsageRange = '7d'
const WINDOW = 'the last 7 days'

const unknown = (sub: string): Reading => ({ value: null, sub })

/** Dollars to the cent — the form the sidebar wallet prints, so the tile beside it
 *  can never show a differently-rounded balance. */
export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/** Token counts abbreviated the way /usage abbreviates the same figure. */
export const compact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

/**
 * One line naming why a read failed. The full explanation is the canonical
 * `BackendStateCard`; a stat tile has room for a sentence, so the two states that
 * imply an action get their own and every other carries the backend's own words.
 */
export function reason(s: BackendState): string {
  if (s.kind === 'signin') return 'Sign in again to see this'
  if (s.kind === 'access') return 'Not enabled for your organization'
  return `Unavailable — ${s.message}`
}

/** Organization credits, from the shared live balance. */
export function credit(
  phase: BalancePhase,
  cents: number | null,
  error: string | undefined,
  timedOut: boolean,
): Reading {
  switch (phase) {
    case 'ready':
      return cents === null ? unknown('Balance not reported') : { value: usd(cents), sub: 'View billing' }
    case 'noauth':
      return unknown('Sign in again to see your balance')
    case 'unconfigured':
      return unknown('Not available on this deployment yet')
    case 'error':
      return unknown(`Unavailable — retrying${error ? ` · ${error}` : ''}`)
    default:
      return timedOut ? unknown('Unavailable — retrying') : unknown('Loading…')
  }
}

/** Spend this month, from the roll-up's month-to-date total (the field /usage prints). */
export function month(view: TileView, s: UsageSummary | null, state?: BackendState): Reading {
  if (view === 'failed') return unknown(state ? reason(state) : 'Unavailable — retrying')
  if (view === 'pending' || !s) return unknown('Loading…')
  if (!s.spend.available) return unknown('Billing not connected')
  return { value: usd(s.spend.mtdCents), sub: 'all products' }
}

/** Token volume over the window, with the requests and spend that produced it. */
export function volume(view: TileView, s: UsageSummary | null, state?: BackendState): Reading {
  if (view === 'failed') return unknown(state ? reason(state) : 'Unavailable — retrying')
  if (view === 'pending' || !s) return unknown('Loading…')
  if (!s.llm.available) return unknown('Warehouse not connected')
  if (s.llm.tokens === 0) return { value: '0', sub: `No activity in ${WINDOW}` }
  return {
    value: compact(s.llm.tokens),
    sub: `${s.llm.requests.toLocaleString()} requests · ${usd(s.llm.costCents)} in ${WINDOW}`,
  }
}
