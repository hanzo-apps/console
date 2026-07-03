import { describe, it, expect } from 'vitest'

import {
  FAMILIES,
  familyOf,
  isChatModel,
  isCurrentGen,
  isFreeAlias,
  groupByFamily,
  filterFamilies,
  totalModels,
  DEFAULT_MODEL,
} from './families'
import type { CatalogEntry } from './aicatalog'

/**
 * The family taxonomy must reproduce hanzo.chat's picker EXACTLY: Zen first, then
 * Qwen · Meta Llama · DeepSeek · Mistral · Google Gemma · OpenAI GPT-OSS, over the
 * REAL catalog shapes — Zen records carry no provider (matched by name), third-party
 * records carry a provider + slugged id. These fixtures mirror the live
 * `/v1/pricing/models` payload (see ~/work/hanzo/pricing/data/pricing.json).
 */
const m = (o: Partial<CatalogEntry>): CatalogEntry => ({ name: '', available: false, ...o }) as CatalogEntry

// Zen (no provider — name-matched), current + sunset gens + non-chat modalities.
const zen5mini = m({ name: 'zen5-mini', available: true })
const zen5flash = m({ name: 'zen5-flash', available: true })
const zen3vl = m({ name: 'zen3-vl', available: true })
const zen3omni = m({ name: 'zen3-omni', available: true })
const zen4 = m({ name: 'zen4', available: false }) // sunset
const zen4mini = m({ name: 'zen4-mini', available: false }) // sunset
const zen3embed = m({ name: 'zen3-embedding', available: true }) // non-chat
const zen3guard = m({ name: 'zen3-guard', available: true }) // guard
const zen3image = m({ name: 'zen3-image', available: true }) // image
// Third-party (provider + slugged id).
const qwenPlus = m({ id: 'qwen/qwen-plus-2025-07-28', name: 'Qwen: Plus', provider: 'Qwen', available: false })
const qwen2 = m({ id: 'qwen/qwen-2.5-72b', name: 'Qwen: 2.5 72B', provider: 'Qwen', available: false }) // sunset gen
const llama4 = m({ id: 'meta-llama/llama-4-maverick', name: 'Meta: Llama 4 Maverick', provider: 'Meta', available: false })
const dsChat = m({ id: 'deepseek/deepseek-chat-v3.1', name: 'DeepSeek: Chat v3.1', provider: 'DeepSeek', available: false })
const dsDistillQwen = m({ id: 'deepseek/deepseek-r1-distill-qwen-32b', name: 'DeepSeek: R1 Distill Qwen', provider: 'DeepSeek', available: false })
const mistralLarge = m({ id: 'mistralai/mistral-large-2512', name: 'Mistral: Large', provider: 'Mistral', available: false })
const gemma3 = m({ id: 'google/gemma-3-27b-it', name: 'Google: Gemma 3 27B', provider: 'Google', available: false })
const gemini = m({ id: 'google/gemini-2.5-pro', name: 'Google: Gemini 2.5 Pro', provider: 'Google', available: false }) // NOT gemma
const gptoss = m({ id: 'openai/gpt-oss-120b', name: 'OpenAI: GPT-OSS 120B', provider: 'OpenAI', available: false })
const gpt5 = m({ id: 'openai/gpt-5', name: 'OpenAI: GPT-5', provider: 'OpenAI', available: false }) // NOT gpt-oss
const hfQwen = m({ id: 'huggingface/Qwen/Qwen3-4B', name: 'Qwen3 4B', provider: 'HuggingFace', available: false }) // hub mirror — excluded
const gemmaFree = m({ id: 'google/gemma-3-27b-it:free', name: 'Google: Gemma 3 27B (free)', provider: 'Google', available: false })

describe('familyOf — chat-exact curation', () => {
  it('assigns Zen by name (records carry no provider)', () => {
    expect(familyOf(zen5mini)?.id).toBe('zen')
    expect(familyOf(zen3omni)?.id).toBe('zen')
    expect(familyOf(zen4)?.id).toBe('zen')
  })
  it('assigns provider-defined families by provider', () => {
    expect(familyOf(qwenPlus)?.id).toBe('qwen')
    expect(familyOf(llama4)?.id).toBe('llama')
    expect(familyOf(dsChat)?.id).toBe('deepseek')
    expect(familyOf(mistralLarge)?.id).toBe('mistral')
  })
  it('keeps a Qwen-distilled DeepSeek in DeepSeek (its provider), not Qwen', () => {
    expect(familyOf(dsDistillQwen)?.id).toBe('deepseek')
  })
  it('matches the named slices — Gemma ⊂ Google, GPT-OSS ⊂ OpenAI', () => {
    expect(familyOf(gemma3)?.id).toBe('gemma')
    expect(familyOf(gptoss)?.id).toBe('gptoss')
  })
  it('excludes Gemini and proprietary GPT (not in the curated slices)', () => {
    expect(familyOf(gemini)).toBeNull()
    expect(familyOf(gpt5)).toBeNull()
  })
  it('excludes the HuggingFace hub mirror (provider HuggingFace)', () => {
    expect(familyOf(hfQwen)).toBeNull()
  })
})

describe('filters — current-gen chat only', () => {
  it('drops non-chat modalities and guards', () => {
    expect(isChatModel(zen5mini)).toBe(true)
    expect(isChatModel(zen3vl)).toBe(true)
    expect(isChatModel(zen3embed)).toBe(false)
    expect(isChatModel(zen3image)).toBe(false)
    expect(isChatModel(zen3guard)).toBe(false)
  })
  it('drops sunset generations (zen4, qwen2)', () => {
    expect(isCurrentGen(zen4)).toBe(false)
    expect(isCurrentGen(zen4mini)).toBe(false)
    expect(isCurrentGen(qwen2)).toBe(false)
    expect(isCurrentGen(zen5mini)).toBe(true)
    expect(isCurrentGen(qwenPlus)).toBe(true)
  })
  it('flags free-tier duplicate aliases', () => {
    expect(isFreeAlias(gemmaFree)).toBe(true)
    expect(isFreeAlias(gemma3)).toBe(false)
  })
})

describe('groupByFamily — Zen first, no zen4, empty families dropped', () => {
  const catalog = [
    zen4, zen4mini, zen3guard, zen3image, zen3embed, // all filtered out
    zen5flash, zen5mini, zen3vl, zen3omni,
    qwenPlus, qwen2, hfQwen,
    llama4, dsChat, dsDistillQwen, mistralLarge,
    gemma3, gemmaFree, gemini,
    gptoss, gpt5,
  ]
  const groups = groupByFamily(catalog)

  it('orders Zen first, then chat families in taxonomy order', () => {
    expect(groups.map((g) => g.id)).toEqual(['zen', 'qwen', 'llama', 'deepseek', 'mistral', 'gemma', 'gptoss'])
  })
  it('excludes zen4/guard/image/embedding from Zen', () => {
    const zen = groups.find((g) => g.id === 'zen')!
    const names = zen.models.map((x) => x.name)
    expect(names).not.toContain('zen4')
    expect(names).not.toContain('zen4-mini')
    expect(names).not.toContain('zen3-guard')
    expect(names).toContain('zen5-mini')
    expect(names).toContain('zen3-vl')
  })
  it('surfaces the default zen5-mini first among available Zen models', () => {
    const zen = groups.find((g) => g.id === 'zen')!
    expect(zen.models[0].name).toBe(DEFAULT_MODEL)
  })
  it('excludes qwen2, the HF mirror, and the :free alias', () => {
    const qwen = groups.find((g) => g.id === 'qwen')!
    expect(qwen.models.map((x) => x.id)).toEqual(['qwen/qwen-plus-2025-07-28'])
    const gemma = groups.find((g) => g.id === 'gemma')!
    expect(gemma.models.map((x) => x.id)).toEqual(['google/gemma-3-27b-it'])
  })
  it('does not emit an OpenAI/Google family for proprietary-only models', () => {
    // gpt-5 and gemini are the only non-slice OpenAI/Google models — they must not
    // create a bare "OpenAI"/"Google" family.
    expect(groups.some((g) => g.label === 'OpenAI' || g.label === 'Google')).toBe(false)
  })
  it('counts totals correctly', () => {
    expect(totalModels(groups)).toBe(
      groups.reduce((n, g) => n + g.models.length, 0),
    )
  })
})

describe('filterFamilies — search across families', () => {
  const groups = groupByFamily([zen5mini, zen3vl, qwenPlus, llama4, gptoss])
  it('keeps only families with a matching model', () => {
    const r = filterFamilies(groups, 'gpt-oss')
    expect(r.map((g) => g.id)).toEqual(['gptoss'])
  })
  it('matches on family label too', () => {
    const r = filterFamilies(groups, 'llama')
    expect(r.map((g) => g.id)).toEqual(['llama'])
  })
  it('empty query returns all', () => {
    expect(filterFamilies(groups, '  ').length).toBe(groups.length)
  })
})

describe('FAMILIES registry', () => {
  it('is exactly the 7 chat families, Zen first', () => {
    expect(FAMILIES.map((f) => f.label)).toEqual([
      'Zen', 'Qwen', 'Meta Llama', 'DeepSeek', 'Mistral', 'Google Gemma', 'OpenAI GPT-OSS',
    ])
  })
})
