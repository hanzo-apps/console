/**
 * ProviderLogo brand resolution — the guardrail for the catalog's logos.
 *
 * Two bugs this locks down:
 *   1. Zen models tagged provider "hanzo" rendered the block-H instead of the
 *      ensō → within one Zen family the mark flip-flopped. Directive: Zen is
 *      ALWAYS the Zen (ensō) brand.
 *   2. Every third-party family (Qwen/OpenAI/DeepSeek/Meta/Mistral/Google) fell
 *      through to a gray initials chip ("QW"). Each curated family logo key must
 *      resolve to a real brand tile — no family shows the neutral fallback.
 */
import { describe, it, expect } from 'vitest'
import { normalizeBrand } from './brand'
import { FAMILIES } from '~/lib/api/families'

describe('normalizeBrand', () => {
  it('resolves every Zen signal to the zen brand (always ensō)', () => {
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
