import { describe, it, expect } from 'vitest'
import {
  pluckList,
  normalizeCredit,
  normalizeFunding,
  foldFunding,
  creditSummary,
  runwayLabel,
  runwayTone,
  creditBadge,
  usd,
  compactNumber,
  fundingWindow,
  fundingLabel,
  fundingColor,
  FUNDING_META,
  type FundingRow,
} from './provider-billing'

describe('pluckList — tolerant list extraction (bare array OR envelope)', () => {
  it('returns a bare array unchanged', () => {
    expect(pluckList([{ a: 1 }])).toEqual([{ a: 1 }])
  })
  it('unwraps the casibase {data:[...]} envelope', () => {
    expect(pluckList({ status: 'ok', msg: '', data: [{ a: 1 }] })).toEqual([{ a: 1 }])
  })
  it('unwraps a named {usage:[...]} / {funding:[...]} / {providers:[...]} wrapper', () => {
    expect(pluckList({ usage: [1] })).toEqual([1])
    expect(pluckList({ funding: [2] })).toEqual([2])
    expect(pluckList({ providers: [3] })).toEqual([3])
  })
  it('degrades to [] for null / garbage / object-without-array', () => {
    expect(pluckList(null)).toEqual([])
    expect(pluckList('nope')).toEqual([])
    expect(pluckList({ nope: 1 })).toEqual([])
  })
})

describe('normalizeCredit — snake_case + camelCase, honest defaults', () => {
  it('reads the exact contract (snake_case) shape', () => {
    const c = normalizeCredit({
      provider: 'do-ai',
      grant_cents: 2_600_000,
      burn_cents: 41_200,
      remaining_cents: 2_418_000,
      runway_days: 58,
      has_credit: true,
      is_paid_only: false,
    })
    expect(c).toEqual({
      provider: 'do-ai',
      grantCents: 2_600_000,
      burnCents: 41_200,
      remainingCents: 2_418_000,
      runwayDays: 58,
      hasCredit: true,
      isPaidOnly: false,
    })
  })
  it('also accepts camelCase keys', () => {
    const c = normalizeCredit({ provider: 'x', grantCents: 100, remainingCents: 40, burnCents: 10, runwayDays: 4, hasCredit: true, isPaidOnly: false })
    expect(c.grantCents).toBe(100)
    expect(c.runwayDays).toBe(4)
  })
  it('runway_days null / absent → null (N/A, distinct from 0)', () => {
    expect(normalizeCredit({ provider: 'x', runway_days: null }).runwayDays).toBeNull()
    expect(normalizeCredit({ provider: 'x' }).runwayDays).toBeNull()
    expect(normalizeCredit({ provider: 'x', runway_days: 0 }).runwayDays).toBe(0)
  })
  it('derives has_credit from a positive balance when the flag is absent', () => {
    expect(normalizeCredit({ provider: 'x', remaining_cents: 500 }).hasCredit).toBe(true)
    expect(normalizeCredit({ provider: 'x', remaining_cents: 0 }).hasCredit).toBe(false)
  })
  it('garbage row → an all-zero honest record, never a throw', () => {
    const c = normalizeCredit(undefined)
    expect(c.provider).toBe('')
    expect(c.grantCents).toBe(0)
    expect(c.hasCredit).toBe(false)
  })
})

describe('normalizeFunding — contract shape + funding lower-cased', () => {
  it('reads the exact contract (snake_case) shape', () => {
    const r = normalizeFunding({ provider: 'do-ai', model: 'glm-5.2', funding: 'credit', tokens: 12_345, cost_cents: 210, requests: 7 })
    expect(r).toEqual({ provider: 'do-ai', model: 'glm-5.2', funding: 'credit', tokens: 12_345, costCents: 210, requests: 7 })
  })
  it('lower-cases the funding class', () => {
    expect(normalizeFunding({ funding: 'PAID_ONLY' }).funding).toBe('paid_only')
  })
  it('tolerates camelCase / alt keys', () => {
    const r = normalizeFunding({ provider: 'p', model_id: 'm', fundingClass: 'byo', totalTokens: 5, costCents: 9, requestCount: 2 })
    expect(r.model).toBe('m')
    expect(r.funding).toBe('byo')
    expect(r.tokens).toBe(5)
    expect(r.requests).toBe(2)
  })
})

describe('foldFunding — per-class split, total, ordered cost slices', () => {
  const rows: FundingRow[] = [
    { provider: 'do-ai', model: 'glm-5.2', funding: 'credit', tokens: 100, costCents: 300, requests: 3 },
    { provider: 'do-ai', model: 'glm-5.2', funding: 'credit', tokens: 50, costCents: 150, requests: 2 },
    { provider: 'openrouter', model: 'gpt-5', funding: 'paid', tokens: 20, costCents: 500, requests: 1 },
    { provider: 'x', model: 'm', funding: 'byo', tokens: 10, costCents: 0, requests: 1 },
  ]
  it('sums each class and the grand total', () => {
    const f = foldFunding(rows)
    expect(f.byClass.credit).toEqual({ tokens: 150, costCents: 450, requests: 5 })
    expect(f.byClass.paid).toEqual({ tokens: 20, costCents: 500, requests: 1 })
    expect(f.byClass.byo).toEqual({ tokens: 10, costCents: 0, requests: 1 })
    expect(f.total).toEqual({ tokens: 180, costCents: 950, requests: 7 })
  })
  it('emits cost slices in FUNDING_ORDER (credit, paid, …), colored', () => {
    const f = foldFunding(rows)
    expect(f.costSlices.map((s) => s.label)).toEqual(['Our credit', 'Paid', 'BYO key'])
    expect(f.costSlices[0].color).toBe(FUNDING_META.credit.color)
    expect(f.costSlices[0].value).toBe(450)
  })
  it('keeps an unknown funding class in its own bucket (never dropped)', () => {
    const f = foldFunding([{ provider: 'p', model: 'm', funding: 'grant', tokens: 1, costCents: 9, requests: 1 }])
    expect(f.byClass.grant.costCents).toBe(9)
    expect(f.costSlices[0].label).toBe('grant')
  })
  it('empty rows → zero total, no slices', () => {
    const f = foldFunding([])
    expect(f.total).toEqual({ tokens: 0, costCents: 0, requests: 0 })
    expect(f.costSlices).toEqual([])
  })
})

describe('creditSummary — headline aggregate', () => {
  it('sums grants/remaining/burn and takes the MIN runway across credit providers', () => {
    const s = creditSummary([
      { provider: 'do-ai', grantCents: 2_600_000, burnCents: 41_200, remainingCents: 2_418_000, runwayDays: 58, hasCredit: true, isPaidOnly: false },
      { provider: 'openrouter', grantCents: 100_000, burnCents: 20_000, remainingCents: 80_000, runwayDays: 4, hasCredit: true, isPaidOnly: false },
      { provider: 'openai-direct', grantCents: 0, burnCents: 5_000, remainingCents: 0, runwayDays: null, hasCredit: false, isPaidOnly: true },
    ])
    expect(s.totalGrantCents).toBe(2_700_000)
    expect(s.totalRemainingCents).toBe(2_498_000)
    expect(s.totalBurnCents).toBe(66_200)
    expect(s.minRunwayDays).toBe(4) // the provider that runs out first
    expect(s.providersWithCredit).toBe(2)
    expect(s.providers).toBe(3)
  })
  it('no credit providers → minRunwayDays null', () => {
    expect(creditSummary([]).minRunwayDays).toBeNull()
  })
})

describe('runwayLabel / runwayTone', () => {
  it('formats days, N/A, and infinite', () => {
    expect(runwayLabel(null)).toBe('—')
    expect(runwayLabel(0.4)).toBe('< 1 day')
    expect(runwayLabel(1)).toBe('1 day')
    expect(runwayLabel(58)).toBe('58 days')
    expect(runwayLabel(1_234)).toBe('1,234 days')
    expect(runwayLabel(3650)).toBe('∞')
  })
  it('tones by urgency', () => {
    expect(runwayTone(null)).toBe('ok')
    expect(runwayTone(5)).toBe('crit')
    expect(runwayTone(30)).toBe('warn')
    expect(runwayTone(120)).toBe('ok')
  })
})

describe('creditBadge', () => {
  const base = { provider: 'x', grantCents: 0, burnCents: 0, remainingCents: 0, runwayDays: null }
  it('has-credit → credit; paid-only → paid; else depleted', () => {
    expect(creditBadge({ ...base, hasCredit: true, isPaidOnly: false }).tone).toBe('credit')
    expect(creditBadge({ ...base, hasCredit: false, isPaidOnly: true }).tone).toBe('paid')
    expect(creditBadge({ ...base, hasCredit: false, isPaidOnly: false }).tone).toBe('empty')
  })
})

describe('formatting', () => {
  it('usd formats cents with 2 decimals + thousands, — for null', () => {
    expect(usd(2_600_000)).toBe('$26,000.00')
    expect(usd(210)).toBe('$2.10')
    expect(usd(null)).toBe('—')
  })
  it('compactNumber', () => {
    expect(compactNumber(842)).toBe('842')
    expect(compactNumber(3_400)).toBe('3.4K')
    expect(compactNumber(1_200_000)).toBe('1.2M')
    expect(compactNumber(2_500_000_000)).toBe('2.5B')
  })
  it('fundingLabel / fundingColor cover known + unknown', () => {
    expect(fundingLabel('credit')).toBe('Our credit')
    expect(fundingLabel('mystery')).toBe('mystery')
    expect(fundingColor('paid')).toBe(FUNDING_META.paid.color)
    expect(fundingColor('mystery')).toBe('#404040')
  })
})

describe('fundingWindow — RFC3339 bounds reusing rangeStart', () => {
  it('7d window is [now-7d, now] as ISO', () => {
    const now = Date.UTC(2026, 6, 10, 12, 0, 0) // 2026-07-10T12:00:00Z
    const { from, to } = fundingWindow('7d', now)
    expect(to).toBe(new Date(now).toISOString())
    expect(from).toBe(new Date(now - 7 * 86_400_000).toISOString())
    expect(from).toBe('2026-07-03T12:00:00.000Z')
  })
})
