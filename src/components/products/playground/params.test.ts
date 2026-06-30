import { describe, it, expect } from 'vitest'

import { paramsOf } from './params'
import { DEFAULT_SETTINGS, type Settings } from './types'

const s = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch })

describe('paramsOf — settings → request fields (omit empties, never fabricate)', () => {
  it('passes temperature + top_p straight through', () => {
    const p = paramsOf(s({ temperature: 0.3, topP: 0.85 }))
    expect(p.temperature).toBe(0.3)
    expect(p.top_p).toBe(0.85)
  })

  it('parses max tokens, flooring; empty / zero / non-numeric → undefined', () => {
    expect(paramsOf(s({ maxTokens: '1024' })).max_tokens).toBe(1024)
    expect(paramsOf(s({ maxTokens: '256.9' })).max_tokens).toBe(256)
    expect(paramsOf(s({ maxTokens: '' })).max_tokens).toBeUndefined()
    expect(paramsOf(s({ maxTokens: '0' })).max_tokens).toBeUndefined()
    expect(paramsOf(s({ maxTokens: 'abc' })).max_tokens).toBeUndefined()
  })

  it('splits stop sequences, trimming and dropping empties; none → undefined', () => {
    expect(paramsOf(s({ stop: 'END, ### , ' })).stop).toEqual(['END', '###'])
    expect(paramsOf(s({ stop: '' })).stop).toBeUndefined()
  })

  it('omits the penalties when 0 (the no-op default), sends a non-zero value', () => {
    expect(paramsOf(s({ frequencyPenalty: 0, presencePenalty: 0 })).frequency_penalty).toBeUndefined()
    expect(paramsOf(s({ frequencyPenalty: 0 })).presence_penalty).toBeUndefined()
    expect(paramsOf(s({ frequencyPenalty: 0.5, presencePenalty: -0.25 })).frequency_penalty).toBe(0.5)
    expect(paramsOf(s({ frequencyPenalty: 0.5, presencePenalty: -0.25 })).presence_penalty).toBe(-0.25)
  })

  it('treats an empty seed as default but keeps a real seed (including 0)', () => {
    expect(paramsOf(s({ seed: '' })).seed).toBeUndefined()
    expect(paramsOf(s({ seed: '  ' })).seed).toBeUndefined()
    expect(paramsOf(s({ seed: 'x' })).seed).toBeUndefined()
    expect(paramsOf(s({ seed: '0' })).seed).toBe(0)
    expect(paramsOf(s({ seed: '42' })).seed).toBe(42)
  })
})
