import { describe, it, expect } from 'vitest'

import {
  newProvider,
  applyCategory,
  applyType,
  showSubType,
  showRegion,
  showClientSecret,
  temperatureEnabled,
  topPEnabled,
  showSampling,
} from '~/components/products/providers/logic'

/**
 * The provider editor is a thin render layer over these pure rules (the
 * category→type→subType cascade + conditional field visibility). Porting from
 * the casibase ProviderEditPage, this is the most intricate domain logic in the
 * console, so each branch is pinned.
 */
describe('newProvider', () => {
  it('is a Model/OpenAI/gpt-4 template owned by the caller', () => {
    const p = newProvider('hanzo')
    expect(p.owner).toBe('hanzo')
    expect(p.category).toBe('Model')
    expect(p.type).toBe('OpenAI')
    expect(p.subType).toBe('gpt-4')
    expect(p.state).toBe('Active')
    expect(p.name).toMatch(/^provider_/)
  })

  it('mints a fresh name each call', () => {
    expect(newProvider('hanzo').name).not.toBe(newProvider('hanzo').name)
  })
})

describe('applyCategory', () => {
  it('applies the category defaults (Storage → Local File System)', () => {
    const p = applyCategory(newProvider('o'), 'Storage')
    expect(p.category).toBe('Storage')
    expect(p.type).toBe('Local File System')
  })

  it('applies Embedding defaults (OpenAI / AdaSimilarity)', () => {
    const p = applyCategory(newProvider('o'), 'Embedding')
    expect(p).toMatchObject({ category: 'Embedding', type: 'OpenAI', subType: 'AdaSimilarity' })
  })

  it('sets category without defaults for an unknown category', () => {
    const base = newProvider('o')
    const p = applyCategory(base, 'Public Cloud')
    expect(p.category).toBe('Public Cloud')
    expect(p.type).toBe(base.type) // unchanged
  })

  it('does not mutate the input', () => {
    const base = newProvider('o')
    applyCategory(base, 'Storage')
    expect(base.category).toBe('Model')
  })
})

describe('applyType', () => {
  it('applies the subType default for the current category', () => {
    const p = applyType({ ...newProvider('o'), category: 'Model' }, 'Claude')
    expect(p.type).toBe('Claude')
    expect(p.subType).toBe('claude-opus-4-0')
  })

  it('leaves subType when the type has no mapped default', () => {
    const base = { ...newProvider('o'), category: 'Model', subType: 'keep-me' }
    const p = applyType(base, 'SomeUnknownType')
    expect(p.type).toBe('SomeUnknownType')
    expect(p.subType).toBe('keep-me')
  })
})

describe('field visibility', () => {
  const m = (over: Record<string, unknown>) => ({ ...newProvider('o'), ...over }) as never

  it('showSubType: model-family categories only', () => {
    expect(showSubType(m({ category: 'Model' }))).toBe(true)
    expect(showSubType(m({ category: 'Embedding' }))).toBe(true)
    expect(showSubType(m({ category: 'Storage' }))).toBe(false)
  })

  it('showRegion: hidden for model/storage/agent kinds and for k8s/ethereum', () => {
    expect(showRegion(m({ category: 'Storage' }))).toBe(false)
    expect(showRegion(m({ category: 'Model' }))).toBe(false)
    expect(showRegion(m({ category: 'Public Cloud' }))).toBe(true)
    expect(showRegion(m({ category: 'Blockchain', type: 'Ethereum' }))).toBe(false)
    expect(showRegion(m({ category: 'Blockchain', type: 'Solana' }))).toBe(true)
    expect(showRegion(m({ category: 'Private Cloud', type: 'Kubernetes' }))).toBe(false)
  })

  it('showClientSecret: hidden for MCP agents, scans, dummy/ollama, non-OpenAI storage', () => {
    expect(showClientSecret(m({ category: 'Model', type: 'OpenAI' }))).toBe(true)
    expect(showClientSecret(m({ category: 'Agent', type: 'MCP' }))).toBe(false)
    expect(showClientSecret(m({ category: 'Scan', type: 'Nmap' }))).toBe(false)
    expect(showClientSecret(m({ category: 'Model', type: 'Ollama' }))).toBe(false)
    expect(showClientSecret(m({ category: 'Model', type: 'Dummy' }))).toBe(false)
    expect(showClientSecret(m({ category: 'Storage', type: 'Local File System' }))).toBe(false)
  })

  it('showSampling: only for Model providers', () => {
    expect(showSampling(m({ category: 'Model' }))).toBe(true)
    expect(showSampling(m({ category: 'Embedding' }))).toBe(false)
  })
})

describe('temperatureEnabled / topPEnabled', () => {
  const m = (over: Record<string, unknown>) => ({ ...newProvider('o'), ...over }) as never

  it('is off for non-Model categories', () => {
    expect(temperatureEnabled(m({ category: 'Embedding' }))).toBe(false)
  })

  it('is on for sampling-capable types (Gemini, DeepSeek, Ollama, …)', () => {
    expect(temperatureEnabled(m({ category: 'Model', type: 'Gemini' }))).toBe(true)
    expect(temperatureEnabled(m({ category: 'Model', type: 'DeepSeek' }))).toBe(true)
  })

  it('is on for OpenAI chat models but OFF for o1/o3/o4 reasoning models', () => {
    expect(temperatureEnabled(m({ category: 'Model', type: 'OpenAI', subType: 'gpt-4' }))).toBe(true)
    expect(temperatureEnabled(m({ category: 'Model', type: 'OpenAI', subType: 'o1-preview' }))).toBe(false)
    expect(temperatureEnabled(m({ category: 'Model', type: 'OpenAI', subType: 'o3-mini' }))).toBe(false)
  })

  it('is off for types with no sampling support (e.g. Claude is not in the list)', () => {
    expect(temperatureEnabled(m({ category: 'Model', type: 'Claude' }))).toBe(false)
  })

  it('topPEnabled mirrors temperatureEnabled', () => {
    expect(topPEnabled).toBe(temperatureEnabled)
  })
})
