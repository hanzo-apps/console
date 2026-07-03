import { describe, it, expect } from 'vitest'

import { randomName } from './naming'

describe('randomName', () => {
  it('is a lowercase adjective-animal, hyphen-joined', () => {
    for (let i = 0; i < 200; i++) {
      const n = randomName()
      expect(n).toMatch(/^[a-z]+-[a-z]+$/)
    }
  })

  it('appends a short readable suffix only when asked', () => {
    for (let i = 0; i < 200; i++) {
      const n = randomName({ suffix: true })
      expect(n).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]{1,3}$/)
    }
  })

  it('varies across calls (not a constant)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) seen.add(randomName())
    expect(seen.size).toBeGreaterThan(1)
  })
})
