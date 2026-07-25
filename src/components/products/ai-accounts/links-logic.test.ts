import { describe, it, expect } from 'vitest'
import { kindLabel, billingLabel, headroomTone, accountTitle, sinceText, summarize, pctText } from './links-logic'
import type { Device, Link } from '~/lib/api/links'

const link = (over: Partial<Link>): Link => ({
  id: 'l', user: 'u', machine: 'm', provider: 'claude', kind: 'subscription', billing: 'plan', status: 'linked', ...over,
})

describe('labels + tones', () => {
  it('kind + billing read in plain words', () => {
    expect(kindLabel('subscription')).toBe('Subscription')
    expect(kindLabel('apikey')).toBe('API key')
    expect(billingLabel('plan')).toBe('Billed to your plan')
    expect(billingLabel('commerce')).toBe('Billed via credits')
  })
  it('headroom tone: healthy → warning → exhausted, by weight not hue', () => {
    expect(headroomTone(80)).toBe('var(--color11)') // positive
    expect(headroomTone(30)).toBe('var(--color11)') // warning
    expect(headroomTone(5)).toBe('var(--color12)') // critical — the one you must not miss
    for (const p of [80, 30, 5]) expect(headroomTone(p)).toMatch(/^var\(--color(9|10|11|12)\)$/)
  })
  it('pctText is honest about missing numbers', () => {
    expect(pctText(42)).toBe('42%')
    expect(pctText(undefined)).toBe('—')
    expect(pctText(Number.NaN)).toBe('—')
  })
})

describe('accountTitle', () => {
  it('prefers plan, then account, then provider', () => {
    expect(accountTitle(link({ plan: 'Claude Max', account: 'a@x' }))).toBe('Claude Max')
    expect(accountTitle(link({ plan: '', account: 'a@x' }))).toBe('a@x')
    expect(accountTitle(link({ plan: '', account: '', provider: 'codex' }))).toBe('codex')
  })
})

describe('sinceText', () => {
  const now = Date.parse('2026-07-15T12:00:00Z')
  it('renders a relative time, honest "—" on absent/garbage', () => {
    expect(sinceText(undefined, now)).toBe('—')
    expect(sinceText('not-a-date', now)).toBe('—')
    expect(sinceText('2026-07-15T11:59:30Z', now)).toBe('just now')
    expect(sinceText('2026-07-15T11:30:00Z', now)).toBe('30m ago')
    expect(sinceText('2026-07-15T06:00:00Z', now)).toBe('6h ago')
    expect(sinceText('2026-07-13T12:00:00Z', now)).toBe('2d ago')
  })
})

describe('summarize', () => {
  it('rolls up LINKED accounts only; excludes revoked; sums spend + sessions', () => {
    const devices: Device[] = [
      {
        machine: 'm1', host: 'box1', activeSessions: 2,
        accounts: [
          link({ id: '1', machine: 'm1', kind: 'subscription', usage: { sessionPct: 0, weeklyPct: 0, tokens: 0, spendCents: 0 } }),
          link({ id: '2', machine: 'm1', kind: 'apikey', billing: 'commerce', usage: { sessionPct: 0, weeklyPct: 0, tokens: 0, spendCents: 250 } }),
          link({ id: '3', machine: 'm1', kind: 'subscription', status: 'revoked', usage: { sessionPct: 0, weeklyPct: 0, tokens: 0, spendCents: 999 } }),
        ],
      },
      {
        machine: 'm2', host: 'box2', activeSessions: 1,
        accounts: [link({ id: '4', machine: 'm2', kind: 'apikey', billing: 'commerce', usage: { sessionPct: 0, weeklyPct: 0, tokens: 0, spendCents: 100 } })],
      },
      // a device whose only account is revoked doesn't count as an active device
      { machine: 'm3', host: 'box3', activeSessions: 0, accounts: [link({ id: '5', machine: 'm3', status: 'revoked' })] },
    ]
    expect(summarize(devices)).toEqual({
      devices: 2, // m1 + m2 (m3 all-revoked excluded)
      accounts: 3, // 1,2 (m1) + 4 (m2) — revoked 3 & 5 excluded
      subscriptions: 1,
      apikeys: 2,
      spendCents: 350, // 250 + 100; revoked 999 excluded
      activeSessions: 3, // 2 + 1 + 0
    })
  })
})
