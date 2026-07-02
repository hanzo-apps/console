import { describe, it, expect } from 'vitest'

import { toIssues, summarize, wcagTags, IMPACTS } from './scan'

/**
 * The a11y scan is pure over an axe-core result — so it is tested with a realistic
 * axe `violations` fixture, no browser or engine. Pins (1) WCAG tag formatting,
 * (2) flatten + severity sort + node counting, (3) null/garbage never throws, and
 * (4) the by-impact summary.
 */
const VIOLATIONS = [
  {
    id: 'color-contrast',
    impact: 'serious',
    help: 'Elements must have sufficient color contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    tags: ['cat.color', 'wcag2aa', 'wcag143'],
    nodes: [{ target: ['.btn'] }, { target: ['a.link'] }],
  },
  {
    id: 'image-alt',
    impact: 'critical',
    help: 'Images must have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
    tags: ['cat.text-alternatives', 'wcag2a', 'wcag111'],
    nodes: [{ target: ['img'] }],
  },
  {
    id: 'region',
    impact: null, // best-practice rules can carry a null impact
    help: 'All page content should be contained by landmarks',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/region',
    tags: ['cat.keyboard', 'best-practice'],
    nodes: [],
  },
]

describe('a11y scan — pure violation processing', () => {
  it('formats WCAG tags: success criteria + conformance level, drops the rest', () => {
    expect(wcagTags(['cat.color', 'wcag2aa', 'wcag143'])).toEqual(['WCAG 2 AA', '1.4.3'])
    expect(wcagTags(['wcag21aa', 'wcag412'])).toEqual(['WCAG 2.1 AA', '4.1.2'])
    expect(wcagTags(['best-practice'])).toEqual([])
    expect(wcagTags(null)).toEqual([])
  })

  it('flattens + sorts critical→minor, counts nodes, degrades null impact to minor', () => {
    const issues = toIssues(VIOLATIONS)
    expect(issues.map((i) => i.id)).toEqual(['image-alt', 'color-contrast', 'region'])
    expect(issues[0]).toMatchObject({ impact: 'critical', nodes: 1, target: 'img' })
    expect(issues[1]).toMatchObject({ impact: 'serious', nodes: 2, target: '.btn' })
    expect(issues[1].wcag).toEqual(['WCAG 2 AA', '1.4.3'])
    expect(issues[2].impact).toBe('minor') // null → minor, never crashes the sort
  })

  it('never throws on garbage input', () => {
    expect(toIssues(null)).toEqual([])
    expect(toIssues('nope')).toEqual([])
    expect(toIssues([null, {}, { id: 'x', nodes: 'bad' }]).map((i) => i.id)).toEqual(['x'])
  })

  it('summarizes counts by impact (all four keys present)', () => {
    const s = summarize(toIssues(VIOLATIONS))
    expect(s.total).toBe(3)
    expect(s.byImpact).toEqual({ critical: 1, serious: 1, moderate: 0, minor: 1 })
    expect(IMPACTS).toEqual(['critical', 'serious', 'moderate', 'minor'])
  })
})
