import { describe, it, expect } from 'vitest'

import type { UsageSummary } from '~/lib/api/usage-summary'
import { credit, month, volume, usd, compact, reason, RANGE } from './figures'

/**
 * The home landing figures. These prove the one property the screen kept breaking:
 * a dash is UNKNOWN. It is never a zero the account really has, and never a 200 the
 * page failed to read — every dash carries the reason beside it.
 */

const summary = (over: {
  spendAvailable?: boolean
  mtdCents?: number
  llmAvailable?: boolean
  tokens?: number
  requests?: number
  costCents?: number
}): UsageSummary => ({
  range: RANGE,
  start: '',
  end: '',
  interval: 'day',
  org: 'hanzo',
  spend: {
    available: over.spendAvailable ?? true,
    totalCents: 0,
    mtdCents: over.mtdCents ?? 0,
    overageCents: 0,
    balanceCents: 0,
    availableCents: 0,
    byCategory: [],
    series: [],
  },
  llm: {
    available: over.llmAvailable ?? true,
    requests: over.requests ?? 0,
    tokens: over.tokens ?? 0,
    promptTokens: 0,
    completionTokens: 0,
    costCents: over.costCents ?? 0,
    models: 0,
  },
  sources: { commerce: true, warehouse: true },
})

describe('formatting', () => {
  it('prints dollars to the cent, the way the sidebar wallet does', () => {
    // The header and this tile read the SAME cents; they must not round differently.
    expect(usd(14976270)).toBe('$149,762.70')
    expect(usd(0)).toBe('$0.00')
    // Grouped: the tile sits beside a request count that already groups, and a
    // six-figure balance printed flat is a number you count digits in.
    expect(usd(100000)).toBe('$1,000.00')
    expect(usd(99999)).toBe('$999.99')
  })

  it('abbreviates token counts the way /usage does', () => {
    expect(compact(11261032)).toBe('11.3M')
    expect(compact(1279)).toBe('1.3K')
    expect(compact(7)).toBe('7')
  })
})

describe('credit — the balance tile', () => {
  it('shows the live balance once it lands', () => {
    expect(credit('ready', 14976270, undefined, false)).toEqual({ value: '$149,762.70', sub: 'View billing' })
  })

  it('shows a real empty wallet as $0.00, never as a dash', () => {
    expect(credit('ready', 0, undefined, false).value).toBe('$0.00')
  })

  it('dashes with the reason when the read fails, and again when it hangs', () => {
    expect(credit('error', null, 'boom', false)).toEqual({ value: null, sub: 'Unavailable — retrying · boom' })
    expect(credit('loading', null, undefined, true).value).toBeNull()
    expect(credit('loading', null, undefined, true).sub).toBe('Unavailable — retrying')
  })

  it('separates a lapsed session from a deployment that has no balance', () => {
    expect(credit('noauth', null, undefined, false).sub).toBe('Sign in again to see your balance')
    expect(credit('unconfigured', null, undefined, false).sub).toBe('Not available on this deployment yet')
  })

  it('does not print a balance the payload never carried', () => {
    expect(credit('ready', null, undefined, false)).toEqual({ value: null, sub: 'Balance not reported' })
  })
})

describe('month — spend this month', () => {
  it('shows month-to-date from the roll-up', () => {
    expect(month('ready', summary({ mtdCents: 18620 }))).toEqual({ value: '$186.20', sub: 'all products' })
  })

  it('shows a genuine zero as $0.00', () => {
    expect(month('ready', summary({ mtdCents: 0 })).value).toBe('$0.00')
  })

  it('dashes when commerce did not answer — a 200 with no data is not a zero', () => {
    expect(month('ready', summary({ spendAvailable: false }))).toEqual({
      value: null,
      sub: 'Billing not connected',
    })
  })

  it('dashes with the failure reason', () => {
    expect(month('failed', null, { kind: 'signin', message: 'Not authorized' }).sub).toBe('Sign in again to see this')
    expect(month('failed', null, { kind: 'error', message: 'gateway blip' }).sub).toBe('Unavailable — gateway blip')
    expect(month('pending', null).sub).toBe('Loading…')
  })
})

describe('volume — token volume', () => {
  it('shows tokens with the requests and spend behind them', () => {
    expect(volume('ready', summary({ tokens: 11261032, requests: 1272, costCents: 3562 }))).toEqual({
      value: '11.3M',
      sub: '1,272 requests · $35.62 in the last 7 days',
    })
  })

  it('shows a true zero as 0 — the empty-week copy, not a dash', () => {
    expect(volume('ready', summary({ tokens: 0 }))).toEqual({
      value: '0',
      sub: 'No activity in the last 7 days',
    })
  })

  it('dashes when the warehouse did not answer, rather than claiming no activity', () => {
    expect(volume('ready', summary({ llmAvailable: false, tokens: 0 }))).toEqual({
      value: null,
      sub: 'Warehouse not connected',
    })
  })

  it('dashes with the failure reason', () => {
    expect(volume('failed', null, { kind: 'access', message: 'Not authorized' }).sub).toBe(
      'Not enabled for your organization',
    )
    expect(volume('failed', null).sub).toBe('Unavailable — retrying')
  })
})

describe('reason', () => {
  it('carries the backend own words when the state implies no action', () => {
    expect(reason({ kind: 'not-initialized', message: 'usage runtime not configured' })).toBe(
      'Unavailable — usage runtime not configured',
    )
  })
})
