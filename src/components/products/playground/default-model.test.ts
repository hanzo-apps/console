import { describe, it, expect } from 'vitest'

import { defaultModelId } from './default-model'
import type { ModelOption } from './useModels'

/**
 * The playground opens ready-to-Run: the model selector must preselect our latest
 * NON-PREMIUM Zen flagship, not sit empty ("Choose a model") and never a PREMIUM
 * model (which 402s a $5 trial-only balance on the first Run). These pin the pick
 * policy — the promotion flag first, the non-premium Zen flagship by name, then
 * honest fallbacks — and prove the default is provably non-premium.
 */
const opt = (id: string, extra: Partial<ModelOption> = {}): ModelOption => ({
  id,
  name: id,
  provider: /zen/i.test(id) ? 'zen' : 'openai',
  context: null,
  inputPrice: null,
  outputPrice: null,
  available: true,
  featured: false,
  premium: false,
  ...extra,
})

// The live Zen family the playground must default across.
const zenFamily = ['zen5', 'zen5-pro', 'zen5-max', 'zen5-flash', 'zen5-mini', 'zen5-coder'].map((id) => opt(id))

describe('defaultModelId — the promoted Zen flagship pick', () => {
  it('returns "" for an empty catalog (honest, no fabricated id)', () => {
    expect(defaultModelId([])).toBe('')
  })

  it('defaults to the bare Zen flagship (zen5), never a mini/flash/coder tier', () => {
    // Shuffled so a correct answer cannot come from list position.
    const shuffled = [zenFamily[3], zenFamily[5], zenFamily[1], zenFamily[0], zenFamily[4], zenFamily[2]]
    expect(defaultModelId(shuffled)).toBe('zen5')
  })

  it('honors an explicit catalog promotion (featured) over the name heuristic', () => {
    const opts = [opt('zen5'), opt('zen5-pro', { featured: true })]
    expect(defaultModelId(opts)).toBe('zen5-pro')
  })

  it('auto-tracks the next major — a bare zen6 outranks zen5 with no code change', () => {
    expect(defaultModelId([...zenFamily, opt('zen6')])).toBe('zen6')
  })

  it('prefers a servable flagship over a catalog-only one (ready-to-Run)', () => {
    const opts = [opt('zen5', { available: false }), opt('zen5-pro', { available: true })]
    expect(defaultModelId(opts)).toBe('zen5-pro')
  })

  it('skips auxiliary (embedding/image/tts) models for the chat default', () => {
    const opts = [opt('text-embedding-3'), opt('flux-image'), opt('zen5')]
    expect(defaultModelId(opts)).toBe('zen5')
  })

  it('recognizes Zen by provider even when the id has no "zen" token', () => {
    const opts = [opt('openai/gpt-5', { provider: 'openai' }), opt('flagship-omni', { provider: 'Zen' })]
    expect(defaultModelId(opts)).toBe('flagship-omni')
  })

  it('falls back to a servable text model when no Zen is present', () => {
    const opts = [opt('openai/gpt-5', { available: true }), opt('anthropic/claude', { available: false })]
    expect(defaultModelId(opts)).toBe('openai/gpt-5')
  })

  it('falls back to the first entry when nothing is servable', () => {
    expect(defaultModelId([opt('openai/gpt-5', { available: false })])).toBe('openai/gpt-5')
  })

  // ── non-premium preference (the $5-trial paywall fix) ──────────────────────

  it('skips PREMIUM Zen flagships and defaults to the newest non-premium Zen (zen5-flash)', () => {
    // Live flags: zen5 / zen5-mini / zen5-max premium; zen5-flash / zen5-coder not.
    const live = [
      opt('zen5', { premium: true }),
      opt('zen5-mini', { premium: true }),
      opt('zen5-max', { premium: true }),
      opt('zen5-flash', { premium: false }),
      opt('zen5-coder', { premium: false }),
    ]
    // Shuffled so the answer can't come from list position.
    expect(defaultModelId([live[2], live[4], live[0], live[3], live[1]])).toBe('zen5-flash')
  })

  it('prefers the general-purpose non-premium tier (zen5-flash) over the specialized one (zen5-coder)', () => {
    expect(defaultModelId([opt('zen5-coder'), opt('zen5-flash')])).toBe('zen5-flash')
  })

  it('never defaults to a premium model even when it is the featured promotion', () => {
    // A premium featured flagship must NOT win — a trial user would 402 on Run.
    const id = defaultModelId([opt('zen5', { premium: true, featured: true }), opt('zen5-flash', { premium: false })])
    expect(id).toBe('zen5-flash')
  })

  it('the chosen default is provably non-premium whenever any non-premium model exists', () => {
    const catalog = [
      opt('zen5', { premium: true }),
      opt('zen5-max', { premium: true }),
      opt('zen5-flash', { premium: false }),
      opt('glm-5.2', { provider: 'zhipu', premium: false }),
    ]
    const chosen = catalog.find((o) => o.id === defaultModelId(catalog))
    expect(chosen?.premium).toBe(false)
  })

  it('falls back to a premium model only when EVERY model is premium (a pick beats empty)', () => {
    const allPremium = [opt('zen5', { premium: true }), opt('zen5-max', { premium: true })]
    expect(defaultModelId(allPremium)).toBe('zen5')
  })
})
