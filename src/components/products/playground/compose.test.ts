import { describe, it, expect } from 'vitest'

import { buildRunMessages, validateRun, type ComposeInput } from './compose'

const base: ComposeInput = { mode: 'chat', system: '', messages: [{ role: 'user', content: 'hi' }], vars: {} }

describe('buildRunMessages — chat', () => {
  it('prepends a system message only when non-empty', () => {
    expect(buildRunMessages({ ...base, system: '  ' })).toEqual([{ role: 'user', content: 'hi' }])
    expect(buildRunMessages({ ...base, system: 'You help.' })).toEqual([
      { role: 'system', content: 'You help.' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('keeps the ordered user/assistant turns, dropping blank ones', () => {
    const msgs = buildRunMessages({
      ...base,
      messages: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: '   ' },
        { role: 'user', content: 'q2' },
      ],
    })
    expect(msgs).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
    ])
  })

  it('substitutes {{variables}}', () => {
    expect(buildRunMessages({ ...base, messages: [{ role: 'user', content: 'Hi {{name}}' }], vars: { name: 'Aoi' } })).toEqual([
      { role: 'user', content: 'Hi Aoi' },
    ])
  })

  it('attaches an uploaded image to the last user turn as content parts', () => {
    const msgs = buildRunMessages({ ...base, messages: [{ role: 'user', content: 'what is this?' }], imageUrl: 'data:img' })
    expect(msgs).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:img' } },
        ],
      },
    ])
  })
})

describe('buildRunMessages — completions', () => {
  it('sends a single raw user turn (no system, no extra turns)', () => {
    const msgs = buildRunMessages({
      mode: 'completions',
      system: 'ignored',
      messages: [{ role: 'user', content: 'Once upon a time' }],
      vars: {},
    })
    expect(msgs).toEqual([{ role: 'user', content: 'Once upon a time' }])
  })

  it('is empty when the prompt is blank', () => {
    expect(buildRunMessages({ mode: 'completions', system: '', messages: [{ role: 'user', content: '  ' }], vars: {} })).toEqual([])
  })
})

describe('validateRun', () => {
  it('requires a model', () => {
    expect(validateRun({ ...base, model: '' })).toBe('Choose a model.')
  })
  it('requires a user message', () => {
    expect(validateRun({ ...base, model: 'zen', messages: [{ role: 'user', content: '' }] })).toBe('Enter a user message.')
  })
  it('passes a valid run', () => {
    expect(validateRun({ ...base, model: 'zen' })).toBeNull()
  })
})
