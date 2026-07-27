import { describe, expect, it } from 'vitest'

import { chordMatches, glyphsFor, isEditableTarget, parseHotkey } from './hotkeys'

describe('parseHotkey', () => {
  it('parses a single key', () => {
    expect(parseHotkey('?')).toEqual([{ key: '?', mod: false }])
    expect(parseHotkey('/')).toEqual([{ key: '/', mod: false }])
    expect(parseHotkey('c')).toEqual([{ key: 'c', mod: false }])
  })

  it('parses the platform modifier', () => {
    expect(parseHotkey('mod+k')).toEqual([{ key: 'k', mod: true }])
    expect(parseHotkey('MOD+K')).toEqual([{ key: 'k', mod: true }])
  })

  it('parses a two-key sequence', () => {
    expect(parseHotkey('g h')).toEqual([
      { key: 'g', mod: false },
      { key: 'h', mod: false },
    ])
    expect(parseHotkey('  g   i  ')).toHaveLength(2)
  })

  it('yields nothing for empty or malformed input, so it can never match', () => {
    expect(parseHotkey('')).toEqual([])
    expect(parseHotkey('   ')).toEqual([])
    expect(parseHotkey('mod+')).toEqual([])
  })
})

describe('chordMatches', () => {
  const bare = { key: 'c', mod: false }
  const withMod = { key: 'k', mod: true }

  it('matches a bare key when nothing is held and nothing is focused', () => {
    expect(chordMatches(bare, { key: 'c' }, false)).toBe(true)
    expect(chordMatches(bare, { key: 'C' }, false)).toBe(true)
  })

  it('never fires a bare key while the user is typing', () => {
    expect(chordMatches(bare, { key: 'c' }, true)).toBe(false)
  })

  it('never fires a bare key with a modifier held', () => {
    expect(chordMatches(bare, { key: 'c', metaKey: true }, false)).toBe(false)
    expect(chordMatches(bare, { key: 'c', ctrlKey: true }, false)).toBe(false)
    expect(chordMatches(bare, { key: 'c', altKey: true }, false)).toBe(false)
  })

  it('accepts meta OR ctrl for mod, and fires even inside an input', () => {
    expect(chordMatches(withMod, { key: 'k', metaKey: true }, false)).toBe(true)
    expect(chordMatches(withMod, { key: 'k', ctrlKey: true }, false)).toBe(true)
    expect(chordMatches(withMod, { key: 'k', metaKey: true }, true)).toBe(true)
  })

  it('requires the modifier for a mod chord and rejects alt', () => {
    expect(chordMatches(withMod, { key: 'k' }, false)).toBe(false)
    expect(chordMatches(withMod, { key: 'k', metaKey: true, altKey: true }, false)).toBe(false)
  })

  it('does not match a different key', () => {
    expect(chordMatches(bare, { key: 'd' }, false)).toBe(false)
    expect(chordMatches(withMod, { key: 'j', metaKey: true }, false)).toBe(false)
  })
})

describe('isEditableTarget', () => {
  it('is true for the typing elements', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isEditableTarget({ tagName: 'input' })).toBe(true)
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('is false for everything else, including absent targets', () => {
    expect(isEditableTarget({ tagName: 'DIV' })).toBe(false)
    expect(isEditableTarget({ tagName: 'BUTTON', isContentEditable: false })).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(undefined)).toBe(false)
  })
})

describe('glyphsFor', () => {
  it('prints the platform modifier', () => {
    expect(glyphsFor('mod+k', true)).toEqual(['⌘', 'K'])
    expect(glyphsFor('mod+k', false)).toEqual(['Ctrl', 'K'])
  })

  it('prints one cap per key of a sequence', () => {
    expect(glyphsFor('g h', false)).toEqual(['G', 'H'])
  })

  it('prints punctuation as-is and names the special keys', () => {
    expect(glyphsFor('?', false)).toEqual(['?'])
    expect(glyphsFor('/', false)).toEqual(['/'])
    expect(glyphsFor('escape', false)).toEqual(['Esc'])
    expect(glyphsFor('enter', false)).toEqual(['↵'])
    expect(glyphsFor('arrowup arrowdown', false)).toEqual(['↑', '↓'])
  })

  it('prints nothing for a malformed hotkey', () => {
    expect(glyphsFor('', false)).toEqual([])
  })
})
