import { describe, it, expect } from 'vitest'

import { resolveBuildId } from './build-id.mjs'

/**
 * The build id must be DETERMINISTIC per commit so a rolling deploy never serves
 * one replica's HTML against another replica's `/_next/static/<BUILD_ID>/` path.
 * These lock the precedence: CI-baked commit > git HEAD > package version.
 */
describe('resolveBuildId', () => {
  it('prefers SOURCE_COMMIT — the CI-baked exact commit (production source of truth)', () => {
    expect(resolveBuildId({ env: { SOURCE_COMMIT: 'abc1234' }, gitSha: 'def5678', version: '8.4.89' })).toBe('abc1234')
  })

  it('accepts NEXT_BUILD_ID as an explicit override when SOURCE_COMMIT is unset', () => {
    expect(resolveBuildId({ env: { NEXT_BUILD_ID: 'release-42' }, gitSha: 'def5678', version: '8.4.89' })).toBe('release-42')
  })

  it('falls back to the git HEAD sha for a local build (no CI env)', () => {
    expect(resolveBuildId({ env: {}, gitSha: 'def5678', version: '8.4.89' })).toBe('def5678')
  })

  it('falls back to the package version when neither env nor git is available (image with no .git)', () => {
    expect(resolveBuildId({ env: {}, gitSha: '', version: '8.4.89' })).toBe('v8.4.89')
  })

  it('ignores whitespace-only env values (a blank build-arg must not win)', () => {
    expect(resolveBuildId({ env: { SOURCE_COMMIT: '   ' }, gitSha: 'def5678', version: '8.4.89' })).toBe('def5678')
  })

  it('is deterministic — the same inputs always yield the same id', () => {
    const args = { env: { SOURCE_COMMIT: 'sha' }, gitSha: 'other', version: '1.0.0' }
    expect(resolveBuildId(args)).toBe(resolveBuildId(args))
  })

  it('separates distinct commits — different shas yield different ids', () => {
    const a = resolveBuildId({ env: { SOURCE_COMMIT: 'aaa' }, gitSha: '', version: '1' })
    const b = resolveBuildId({ env: { SOURCE_COMMIT: 'bbb' }, gitSha: '', version: '1' })
    expect(a).not.toBe(b)
  })
})
