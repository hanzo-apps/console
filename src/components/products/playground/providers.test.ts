import { describe, it, expect } from 'vitest'

import { providerGroups, filterGroups, matchOption, totalModels } from './providers'
import type { ModelOption } from './useModels'

const opt = (p: Partial<ModelOption> & { id: string }): ModelOption => ({
  id: p.id,
  name: p.name ?? p.id,
  provider: p.provider ?? 'Other',
  context: p.context ?? null,
  inputPrice: p.inputPrice ?? null,
  outputPrice: p.outputPrice ?? null,
  available: p.available ?? false,
  featured: p.featured ?? false,
})

describe('providerGroups — Zen-first, count-desc', () => {
  it('pins the Zen group first, then orders by model count (desc)', () => {
    const groups = providerGroups([
      opt({ id: 'gpt-5', provider: 'OpenAI' }),
      opt({ id: 'gpt-4o', provider: 'OpenAI' }),
      opt({ id: 'claude', provider: 'Anthropic' }),
      opt({ id: 'zen-omni', provider: 'Zen' }),
    ])
    expect(groups.map((g) => g.provider)).toEqual(['Zen', 'OpenAI', 'Anthropic'])
  })

  it('sorts servable (live) models before unavailable ones within a provider', () => {
    const [g] = providerGroups([
      opt({ id: 'b', name: 'b', provider: 'OpenAI', available: false }),
      opt({ id: 'a', name: 'a', provider: 'OpenAI', available: true }),
    ])
    expect(g.models.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('buckets a missing provider under "Other"', () => {
    const groups = providerGroups([opt({ id: 'x', provider: '' })])
    expect(groups[0].provider).toBe('Other')
  })
})

describe('filterGroups + matchOption', () => {
  const groups = providerGroups([
    opt({ id: 'zen-omni', name: 'Zen Omni', provider: 'Zen' }),
    opt({ id: 'gpt-5', name: 'GPT-5', provider: 'OpenAI' }),
  ])

  it('drops providers with no matching model', () => {
    const filtered = filterGroups(groups, 'gpt')
    expect(filtered.map((g) => g.provider)).toEqual(['OpenAI'])
    expect(totalModels(filtered)).toBe(1)
  })

  it('matches on provider name too', () => {
    expect(matchOption(opt({ id: 'gpt-5', provider: 'OpenAI' }), 'openai')).toBe(true)
  })

  it('empty query returns every group unchanged', () => {
    expect(filterGroups(groups, '   ')).toEqual(groups)
  })
})
