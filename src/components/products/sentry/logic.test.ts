import { describe, expect, it } from 'vitest'
import type { SentryIssue, StatPoint } from '~/lib/api/sentry'
import {
  summarizeIssues,
  levelSlices,
  fmtWhen,
  fmtDateTime,
  fmtCount,
  fmtDurationMs,
  statsToPoints,
  statsTotal,
  ingestUrl,
  sdkSnippet,
  emptyFilter,
  DISCOVER_FIELDS,
  levelColor,
  statusTone,
  logLevelTone,
} from './logic'

const issue = (o: Partial<SentryIssue>): SentryIssue => ({
  id: 'i', shortId: '', title: '', culprit: '', type: 'Error', value: '', level: 'error',
  status: 'unresolved', platform: '', project: '', environment: '', release: '', count: 0,
  userCount: 0, firstSeen: '', lastSeen: '', regressed: false, assignee: '', stats: [], ...o,
})

describe('summarizeIssues', () => {
  it('folds real KPIs (never fabricated)', () => {
    const s = summarizeIssues([
      issue({ status: 'unresolved', count: 10, userCount: 3, regressed: true }),
      issue({ status: 'resolved', count: 5, userCount: 2 }),
      issue({ status: 'unresolved', count: 1, userCount: 1 }),
    ])
    expect(s).toEqual({ total: 3, unresolved: 2, regressed: 1, events: 16, users: 6 })
  })
  it('empty → all zeros', () => {
    expect(summarizeIssues([])).toEqual({ total: 0, unresolved: 0, regressed: 0, events: 0, users: 0 })
  })
})

describe('levelSlices', () => {
  it('groups by level, biggest first, with the level color', () => {
    const s = levelSlices([issue({ level: 'error' }), issue({ level: 'error' }), issue({ level: 'warning' })])
    expect(s[0]).toEqual({ label: 'error', value: 2, color: levelColor('error') })
    expect(s[1].label).toBe('warning')
  })
})

describe('formatters', () => {
  it('fmtWhen is relative + honest on garbage', () => {
    expect(fmtWhen('')).toBe('—')
    expect(fmtWhen('not-a-date')).toBe('—')
    expect(fmtWhen(new Date(Date.now() - 5000).toISOString())).toMatch(/s ago$/)
    expect(fmtWhen(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3h ago')
  })
  it('fmtDateTime accepts ISO + epoch-ms, em-dash on failure', () => {
    expect(fmtDateTime('nope')).toBe('—')
    expect(fmtDateTime(Number.NaN)).toBe('—')
    expect(fmtDateTime(Date.parse('2026-07-10T00:00:00Z'))).not.toBe('—')
  })
  it('fmtCount is compact', () => {
    expect(fmtCount(42)).toBe('42')
    expect(fmtCount(1234)).toBe('1.2k')
    expect(fmtCount(2_500_000)).toBe('2.5M')
    expect(fmtCount(Number.NaN)).toBe('—')
  })
  it('fmtDurationMs switches unit', () => {
    expect(fmtDurationMs(42)).toBe('42ms')
    expect(fmtDurationMs(2100)).toBe('2.1s')
    expect(fmtDurationMs(-1)).toBe('—')
  })
  it('tones resolve to the greyscale ramp — weight, never hue', () => {
    for (const v of [statusTone('resolved'), statusTone('unresolved'), statusTone('ignored'), logLevelTone('WARN'), logLevelTone('info'), levelColor('fatal'), levelColor('nonsense')])
      expect(v).toMatch(/^var\(--color(9|10|11|12)\)$/)
    // Unresolved must out-emphasise resolved; ignored is the quietest.
    expect(statusTone('unresolved')).toBe('var(--color12)')
    expect(statusTone('resolved')).toBe('var(--color11)')
    expect(statusTone('ignored')).toBe('var(--color9)')
    expect(logLevelTone('error')).toBe('var(--color12)')
  })
})

describe('statsToPoints', () => {
  const mk = (mins: number[]): StatPoint[] => mins.map((m) => ({ ts: Date.parse('2026-07-10T00:00:00Z') + m * 60_000, value: m }))
  it('labels intraday points by time and totals correctly', () => {
    const pts = statsToPoints(mk([0, 30, 60]))
    expect(pts).toHaveLength(3)
    expect(pts.every((p) => p.label !== '')).toBe(true)
    expect(statsTotal(mk([1, 2, 3]))).toBe(6)
  })
  it('empty → empty', () => {
    expect(statsToPoints([])).toEqual([])
  })
  it('multi-day span labels by date', () => {
    const day = 86_400_000
    const base = Date.parse('2026-07-01T00:00:00Z')
    const pts = statsToPoints([{ ts: base, value: 1 }, { ts: base + 5 * day, value: 2 }])
    // A 5-day span → date labels (contain a short month name), never a clock time.
    expect(pts[0].label).toMatch(/[A-Za-z]/)
  })
})

describe('project DSN + SDK snippet', () => {
  it('derives the CLEAN ingest endpoint (no /api/ segment)', () => {
    expect(ingestUrl('https://abc123@api.hanzo.ai/v1/event/web')).toBe('https://api.hanzo.ai/v1/event/web/envelope/')
    expect(ingestUrl('')).toBe('')
    expect(ingestUrl('garbage-no-at')).toBe('')
  })
  it('ingest URL never contains /api/', () => {
    expect(ingestUrl('https://k@api.hanzo.ai/v1/event/proj')).not.toContain('/api/')
  })
  it('sdkSnippet embeds the DSN and falls back to a replaceable placeholder', () => {
    expect(sdkSnippet('https://k@api.hanzo.ai/v1/event/web')).toContain("dsn: 'https://k@api.hanzo.ai/v1/event/web'")
    expect(sdkSnippet('')).toContain('<key>@api.hanzo.ai/v1/event/<project>')
  })
})

describe('discover catalogs', () => {
  it('emptyFilter starts on the first field with = op', () => {
    expect(emptyFilter()).toEqual({ field: DISCOVER_FIELDS[0], op: '=', value: '' })
  })
})
