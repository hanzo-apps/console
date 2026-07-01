import { describe, it, expect } from 'vitest'

import { extractBody } from './loaders'

/**
 * extractBody pulls the editable system-prompt text out of a prompt DETAIL payload
 * (the list rows carry metadata, not the body) so a saved-prompt pick always fills
 * the textarea with SOMETHING real. The detail shape isn't a fixed contract, so it
 * reads the common body fields, then the latest version's body, then a JSON dump.
 */
describe('extractBody', () => {
  it('returns a string payload verbatim', () => {
    expect(extractBody('you are helpful')).toBe('you are helpful')
  })

  it('reads a top-level body field (prompt/body/text/content/systemPrompt/system)', () => {
    expect(extractBody({ prompt: 'be terse' })).toBe('be terse')
    expect(extractBody({ body: 'body text' })).toBe('body text')
    expect(extractBody({ text: 'text field' })).toBe('text field')
    expect(extractBody({ content: 'content field' })).toBe('content field')
    expect(extractBody({ systemPrompt: 'sys' })).toBe('sys')
    expect(extractBody({ system: 'sys2' })).toBe('sys2')
  })

  it('prefers an earlier field over later ones, and ignores blank fields', () => {
    expect(extractBody({ prompt: '  ', body: 'real' })).toBe('real')
    expect(extractBody({ prompt: 'win', body: 'lose' })).toBe('win')
  })

  it('reads the latest version body when the payload is versioned', () => {
    const detail = { name: 'p', versions: [{ prompt: 'v1' }, { prompt: 'v2 latest' }] }
    expect(extractBody(detail)).toBe('v2 latest')
  })

  it('falls back to a pretty JSON dump so the user always gets real content', () => {
    const detail = { name: 'p', meta: { foo: 1 } }
    const out = extractBody(detail)
    expect(out).toContain('"name": "p"')
    expect(out).toContain('"foo": 1')
  })

  it('returns "" for null/number (nothing real to show)', () => {
    expect(extractBody(null)).toBe('')
    expect(extractBody(42)).toBe('')
  })
})
