import { describe, expect, it } from 'vitest'

import { parseCommand, renderOutput } from './logic'

describe('parseCommand', () => {
  it('accepts every documented form and normalizes to a /v1-relative path', () => {
    expect(parseCommand('GET /v1/models')).toEqual({ path: 'models' })
    expect(parseCommand('get v1/models')).toEqual({ path: 'models' })
    expect(parseCommand('/v1/models')).toEqual({ path: 'models' })
    expect(parseCommand('models')).toEqual({ path: 'models' })
    expect(parseCommand('  agents?limit=5  ')).toEqual({ path: 'agents?limit=5' })
  })

  it('is read-only — every mutating method is refused', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(parseCommand(`${m} /v1/agents`)).toHaveProperty('error')
    }
  })

  it('refuses empty, multi-path, traversal, and smuggled inputs', () => {
    expect(parseCommand('')).toHaveProperty('error')
    expect(parseCommand('GET')).toHaveProperty('error')
    expect(parseCommand('/v1')).toHaveProperty('error')
    expect(parseCommand('GET /v1/a /v1/b')).toHaveProperty('error')
    expect(parseCommand('/v1/../admin')).toHaveProperty('error')
    expect(parseCommand('//evil.com/x')).toHaveProperty('error')
    expect(parseCommand('https://evil.com/x')).toHaveProperty('error')
  })
})

describe('renderOutput', () => {
  it('pretty-prints JSON and passes strings through', () => {
    expect(renderOutput({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(renderOutput('plain')).toBe('plain')
  })

  it('truncates a huge payload with an honest marker', () => {
    const out = renderOutput('x'.repeat(25000), 100)
    expect(out.startsWith('x'.repeat(100))).toBe(true)
    expect(out).toContain('24900 more characters truncated')
  })
})
