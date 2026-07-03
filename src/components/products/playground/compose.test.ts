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
    const msgs = buildRunMessages({ ...base, messages: [{ role: 'user', content: 'what is this?' }], imageUrls: ['data:img'] })
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

  it('attaches MULTIPLE images as separate image_url parts on the last user turn', () => {
    const msgs = buildRunMessages({
      ...base,
      messages: [{ role: 'user', content: 'compare these' }],
      imageUrls: ['data:a', 'data:b', 'data:c'],
    })
    expect(msgs).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'compare these' },
          { type: 'image_url', image_url: { url: 'data:a' } },
          { type: 'image_url', image_url: { url: 'data:b' } },
          { type: 'image_url', image_url: { url: 'data:c' } },
        ],
      },
    ])
  })

  it('sends an IMAGE-ONLY user message (no text) — content is just the image parts', () => {
    const msgs = buildRunMessages({ ...base, messages: [{ role: 'user', content: '' }], imageUrls: ['data:a', 'data:b'] })
    expect(msgs).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:a' } },
          { type: 'image_url', image_url: { url: 'data:b' } },
        ],
      },
    ])
  })

  it('ignores blank/empty image urls', () => {
    const msgs = buildRunMessages({ ...base, messages: [{ role: 'user', content: 'hi' }], imageUrls: ['', '  '] })
    expect(msgs).toEqual([{ role: 'user', content: 'hi' }]) // no image parts, plain text
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
  it('blocks a genuinely-empty message (no text AND no image) with a clear reason', () => {
    expect(validateRun({ ...base, model: 'zen', messages: [{ role: 'user', content: '' }] })).toBe(
      'Enter a message or attach an image to run.',
    )
  })
  it('an ATTACHED IMAGE counts as user content — an image-only prompt is valid (Run proceeds)', () => {
    expect(
      validateRun({ ...base, model: 'zen', messages: [{ role: 'user', content: '' }], imageUrls: ['data:a'] }),
    ).toBeNull()
  })
  it('passes a valid text run', () => {
    expect(validateRun({ ...base, model: 'zen' })).toBeNull()
  })
  it('completions: blocks a blank prompt with its own message', () => {
    expect(
      validateRun({ mode: 'completions', system: '', messages: [{ role: 'user', content: '  ' }], vars: {}, model: 'zen' }),
    ).toBe('Enter a prompt to run.')
  })
})
