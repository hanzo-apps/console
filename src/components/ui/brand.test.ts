/**
 * ProviderLogo brand resolution — the guardrail for the catalog's logos.
 *
 * Locks down:
 *   1. Zen is ALWAYS the house brand (rendered as the Hanzo mark), whether a model
 *      is tagged provider "hanzo"/"zen" or has a zen* id — never an upstream family
 *      glyph (brand policy). `normalizeBrand` funnels every Zen signal to `zen`.
 *   2. Every third-party family (Qwen/OpenAI/DeepSeek/Meta/Mistral/Google) resolves
 *      to a real brand (never the gray initials fallback) AND has its OWN distinct
 *      mark (`BRAND_MARK`) — no two families read as the same glyph.
 */
import { describe, it, expect } from 'vitest'
import { normalizeBrand, brandForModel, brandLabel, brandMaker, usesHouseMark } from './brand'
import { BRAND_MARK } from './brand-marks'
import { FAMILIES } from '~/lib/api/families'

describe('normalizeBrand', () => {
  it('resolves every Zen signal to the zen brand (the house/Hanzo mark)', () => {
    for (const s of ['zen', 'Zen', 'zenlm', 'zen3-vl', 'zen5-mini', 'zen5-coder', 'zen5-flash']) {
      expect(normalizeBrand(s)).toBe('zen')
    }
  })

  it('keeps the bare Hanzo company provider on the block-H (non-model surfaces)', () => {
    expect(normalizeBrand('hanzo')).toBe('hanzo')
  })

  it('maps every curated family logo key to a real brand (never the gray fallback)', () => {
    for (const f of FAMILIES) {
      expect(normalizeBrand(f.logo), `family ${f.id} logo=${f.logo}`).not.toBeNull()
    }
  })

  it('gives every family with its own maker a distinct mark (only Hanzo\'s render the block-H)', () => {
    const bodies = new Set<string>()
    for (const f of FAMILIES) {
      const brand = normalizeBrand(f.logo)
      if (brand === 'hanzo' || brand === 'enso') continue // Hanzo's own → block-H
      const mark = brand ? BRAND_MARK[brand] : undefined
      expect(mark, `family ${f.id} (brand ${brand}) must have a curated mark`).toBeDefined()
      // No two families share the same glyph body → every family is visually distinct.
      expect(bodies.has(mark!.body), `family ${f.id} mark must be unique`).toBe(false)
      bodies.add(mark!.body)
    }
  })

  it('resolves the third-party families to their canonical brand', () => {
    expect(normalizeBrand('Qwen')).toBe('qwen')
    expect(normalizeBrand('qwen')).toBe('qwen')
    expect(normalizeBrand('OpenAI')).toBe('openai')
    expect(normalizeBrand('DeepSeek')).toBe('deepseek')
    expect(normalizeBrand('Meta')).toBe('meta')
    expect(normalizeBrand('Mistral')).toBe('mistral')
    expect(normalizeBrand('Google')).toBe('google')
  })

  it('resolves common raw provider strings and model tells', () => {
    expect(normalizeBrand('anthropic')).toBe('anthropic')
    expect(normalizeBrand('claude-opus-4-6')).toBe('anthropic')
    expect(normalizeBrand('glm-5.2')).toBe('zhipu')
    expect(normalizeBrand('kimi-k2')).toBe('moonshot')
    expect(normalizeBrand('grok-2')).toBe('xai')
    expect(normalizeBrand('llama-3.3-70b')).toBe('meta')
  })

  it('returns null for genuinely unknown providers (honest initials fallback)', () => {
    expect(normalizeBrand('')).toBeNull()
    expect(normalizeBrand('SomeIndieLab')).toBeNull()
    expect(normalizeBrand('Other')).toBeNull()
  })

  it('curates a distinct mark for the canonical proprietary vendors too (Anthropic added)', () => {
    // The three vendors the storefront #57 fix targets each have their OWN mark now.
    for (const b of ['anthropic', 'openai', 'google'] as const) {
      expect(BRAND_MARK[b], `brand ${b} must have a curated mark`).toBeDefined()
    }
    // …and none of those three collide with each other or any family mark.
    const bodies = Object.values(BRAND_MARK).map((m) => m!.body)
    expect(new Set(bodies).size).toBe(bodies.length)
  })
})

describe('brandForModel — identity-first resolution (the #57 storefront fix)', () => {
  it('resolves a model by its id/name even when the gateway tags provider "hanzo"', () => {
    // The api.hanzo.ai gateway serves third-party models tagged owned_by/provider
    // "hanzo"; the model id must still win so the card shows its TRUE vendor, not Zen.
    expect(brandForModel('qwen3.5-397b', 'hanzo')).toBe('qwen')
    expect(brandForModel('glm-5.2', 'hanzo')).toBe('zhipu')
    expect(brandForModel('kimi-k2.6', 'hanzo')).toBe('moonshot')
    expect(brandForModel('minimax-m2.5', 'hanzo')).toBe('minimax')
  })

  it('resolves the user-reported storefront vendors from their catalog id/name', () => {
    expect(brandForModel('anthropic/claude-opus-4.6', 'Anthropic')).toBe('anthropic')
    expect(brandForModel('openai/gpt-5', 'OpenAI')).toBe('openai')
    expect(brandForModel('google/gemini-2.5-pro', 'Google')).toBe('google')
    expect(brandForModel('x-ai/grok-4', 'xAI')).toBe('xai')
  })

  it('keeps Zen models on the house brand whether keyed by id or provider', () => {
    expect(brandForModel('zen4', 'Hanzo')).toBe('zen')
    expect(brandForModel('zen5-coder', 'hanzo')).toBe('zen')
    expect(brandForModel('zen-max', 'hanzo')).toBe('zen')
  })

  it('leaves a genuinely-Hanzo model on the house brand (Hanzo is only the fallback)', () => {
    // No third-party tell in the id → the provider "hanzo" resolves the house mark.
    expect(brandForModel('hanzo-embed-v1', 'hanzo')).toBe('hanzo')
  })

  it('falls back to the provider, then null, when the id carries no brand', () => {
    expect(brandForModel('some-model', 'Anthropic')).toBe('anthropic')
    expect(brandForModel('some-model', 'SomeIndieLab')).toBeNull()
  })
})

describe('brandLabel — full vendor names for the model-card label', () => {
  it('gives the real vendor name for a resolved third-party brand', () => {
    expect(brandLabel('anthropic')).toBe('Anthropic')
    expect(brandLabel('openai')).toBe('OpenAI')
    expect(brandLabel('google')).toBe('Google')
    expect(brandLabel('qwen')).toBe('Qwen')
    expect(brandLabel('minimax')).toBe('MiniMax')
  })

  it('keeps Zen the FAMILY name and Zoo Labs the MAKER — two facts, two fields', () => {
    expect(brandLabel('zen')).toBe('Zen')
    expect(brandMaker('zen')).toBe('Zoo Labs')
    // Hanzo serves Zen; it does not build it.
    expect(brandMaker('zen')).not.toBe(brandMaker('hanzo'))
    // A family whose name IS its maker's is not restated in the maker map.
    expect(brandMaker('deepseek')).toBe(brandLabel('deepseek'))
  })

  it('sends every zen model down the OWN-mark path, never the block-H', () => {
    // This is the bug in one assertion: a zen id used to render Hanzo's mark.
    for (const id of ['zen', 'zenlm', 'zen5', 'zen5-coder', 'zen3-vl']) {
      const brand = brandForModel(id, 'hanzo')!
      expect(brand, id).toBe('zen')
      expect(usesHouseMark(brand), `${id} must not render the block-H`).toBe(false)
      expect(BRAND_MARK[brand], `${id} must have its own mark to render instead`).toBeDefined()
    }
    // What Hanzo actually builds still does.
    expect(usesHouseMark('hanzo')).toBe(true)
    expect(usesHouseMark('enso')).toBe(true)
  })

  it('gives Zen a mark of its own, and it is not the block-H the Hanzo keys use', () => {
    // The whole point of the change: Zen must not be indistinguishable from Hanzo.
    expect(BRAND_MARK.zen, 'Zen must carry its own mark').toBeDefined()
    expect(BRAND_MARK.hanzo, 'Hanzo renders the block-H in ProviderLogo, not a BRAND_MARK').toBeUndefined()
    expect(BRAND_MARK.enso, 'Enso renders the block-H in ProviderLogo, not a BRAND_MARK').toBeUndefined()
  })

  it('still resolves every zen id and alias to the zen brand', () => {
    for (const id of ['zen', 'zenlm', 'zen5', 'zen5-coder', 'zen3-vl']) {
      expect(normalizeBrand(id), id).toBe('zen')
    }
  })
})
