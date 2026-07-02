import { describe, expect, it } from 'vitest'

import { normalizeMemory } from './memory'

describe('normalizeMemory — a usable key regardless of the backend field', () => {
  it('uses id when present', () => {
    expect(normalizeMemory({ id: 'm1', kind: 'user', content: 'hi' }).id).toBe('m1')
  })
  it('falls back to name (the real backend key) when there is no id — fixes /memory/undefined', () => {
    expect(normalizeMemory({ name: 'fact-42', kind: 'fact', content: 'x' }).id).toBe('fact-42')
    expect(normalizeMemory({ key: 'k9', content: 'x' }).id).toBe('k9')
    expect(normalizeMemory({ memory_id: 'mid', content: 'x' }).id).toBe('mid')
  })
  it('defaults an unknown/absent kind to user, and reads content from content/text/value', () => {
    expect(normalizeMemory({ name: 'a', kind: 'bogus', content: 'c' }).kind).toBe('user')
    expect(normalizeMemory({ name: 'a', kind: 'project' }).kind).toBe('project')
    expect(normalizeMemory({ name: 'a', text: 'from-text' }).content).toBe('from-text')
    expect(normalizeMemory({ name: 'a', value: 'from-value' }).content).toBe('from-value')
  })
  it('reads snake_case timestamps + keeps metadata', () => {
    const m = normalizeMemory({ name: 'a', created_at: '2026-01-01', metadata: { s: 1 } })
    expect(m.createdAt).toBe('2026-01-01')
    expect(m.metadata).toEqual({ s: 1 })
  })
  it('never throws on a malformed row', () => {
    expect(normalizeMemory(null).id).toBe('')
    expect(normalizeMemory('nope').id).toBe('')
  })
})
