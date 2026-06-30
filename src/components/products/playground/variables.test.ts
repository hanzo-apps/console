import { describe, it, expect } from 'vitest'

import { extractVars, collectVars, substitute } from './variables'

describe('extractVars — {{name}} references', () => {
  it('finds names, de-duplicated, in first-seen order', () => {
    expect(extractVars('Hi {{name}}, your {{plan}} and {{name}} again')).toEqual(['name', 'plan'])
  })
  it('tolerates inner whitespace', () => {
    expect(extractVars('a {{  topic }} b')).toEqual(['topic'])
  })
  it('returns [] when there are no variables', () => {
    expect(extractVars('plain text')).toEqual([])
  })
})

describe('collectVars — across several strings', () => {
  it('unions names in first-seen order', () => {
    expect(collectVars(['{{a}} {{b}}', '{{b}} {{c}}'])).toEqual(['a', 'b', 'c'])
  })
})

describe('substitute — fill known, keep unknown verbatim', () => {
  it('replaces known variables', () => {
    expect(substitute('Hi {{name}}', { name: 'Aoi' })).toBe('Hi Aoi')
  })
  it('leaves unknown variables verbatim (honest about what is missing)', () => {
    expect(substitute('Hi {{name}} ({{role}})', { name: 'Aoi' })).toBe('Hi Aoi ({{role}})')
  })
  it('supports an empty value', () => {
    expect(substitute('[{{x}}]', { x: '' })).toBe('[]')
  })
})
