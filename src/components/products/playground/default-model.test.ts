import { describe, it, expect } from 'vitest'

import { defaultModelId } from './default-model'
import type { ModelOption } from './useModels'

/**
 * The playground opens ready-to-Run: the model selector must preselect our latest
 * PROMOTED Zen flagship, not sit empty ("Choose a model"). These pin the pick
 * policy — the promotion flag first (so it auto-tracks zen6 with no code change),
 * then the bare Zen flagship by name, then honest fallbacks.
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
})
