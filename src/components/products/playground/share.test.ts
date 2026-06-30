import { describe, it, expect } from 'vitest'

import { encodeShare, decodeShare, type ShareState } from './share'
import { DEFAULT_SETTINGS } from './types'

const state: ShareState = {
  mode: 'chat',
  model: 'zen-omni',
  system: 'You are helpful.',
  messages: [
    { role: 'user', content: 'Hi {{name}}' },
    { role: 'assistant', content: 'Hello!' },
  ],
  settings: { ...DEFAULT_SETTINGS, temperature: 0.42, maxTokens: '512', seed: '7' },
}

describe('encode/decode — round-trip the composer state', () => {
  it('decodes exactly what was encoded', () => {
    expect(decodeShare(encodeShare(state))).toEqual(state)
  })

  it('returns null for an empty or malformed token', () => {
    expect(decodeShare('')).toBeNull()
    expect(decodeShare('%%%not-json%%%')).toBeNull()
    expect(decodeShare(encodeURIComponent('"a string, not an object"'))).toBeNull()
  })

  it('fills setting defaults for a partial payload (hand-edited link is safe)', () => {
    const token = encodeURIComponent(JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'q' }] }))
    const out = decodeShare(token)
    expect(out?.mode).toBe('chat')
    expect(out?.system).toBe('')
    expect(out?.settings).toEqual(DEFAULT_SETTINGS)
    expect(out?.messages).toEqual([{ role: 'user', content: 'q' }])
  })

  it('coerces an unknown role to user', () => {
    const token = encodeURIComponent(JSON.stringify({ model: 'x', messages: [{ role: 'system', content: 'q' }] }))
    expect(decodeShare(token)?.messages[0].role).toBe('user')
  })
})
