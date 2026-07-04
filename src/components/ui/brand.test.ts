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
import { normalizeBrand } from './brand'
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

  it('gives every third-party family its OWN distinct mark (Zen uses the Hanzo mark)', () => {
    const bodies = new Set<string>()
    for (const f of FAMILIES) {
      const brand = normalizeBrand(f.logo)
      if (brand === 'zen' || brand === 'hanzo') continue // first-party → Hanzo block-H
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
})
