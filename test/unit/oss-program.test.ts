import { describe, it, expect } from 'vitest'

import { OSS_PROGRAM, githubUrl, DOCS_URL } from '~/lib/oss-program'

/** ONE source of truth for the OSS revenue-share program; stated identically everywhere. */
describe('OSS_PROGRAM', () => {
  it('states the share, asset, and a live dividends URL', () => {
    expect(OSS_PROGRAM.revenueSharePct).toBe(25)
    expect(OSS_PROGRAM.payoutAsset).toBe('HUSD')
    expect(OSS_PROGRAM.dividendsUrl).toMatch(/^https:\/\//)
    expect(OSS_PROGRAM.basis).toContain('SBOM')
  })

  it('githubUrl builds an org/repo link', () => {
    expect(githubUrl('hanzoai/vector')).toBe('https://github.com/hanzoai/vector')
  })

  it('DOCS_URL is the canonical docs site', () => {
    expect(DOCS_URL).toBe('https://docs.hanzo.ai')
  })
})
