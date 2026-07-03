import { describe, it, expect } from 'vitest'
import {
  emptyState,
  isSerializedState,
  toEditorState,
  fromEditorState,
  isEmptyState,
  toPlainText,
} from './richtext-serialize'

const lexical = (text: string) =>
  JSON.stringify({
    root: {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', text, format: 0, mode: 'normal', style: '', detail: 0, version: 1 }], direction: 'ltr', format: '', indent: 0, version: 1 },
      ],
      direction: 'ltr',
      format: '',
      indent: 0,
      version: 1,
    },
  })

describe('richtext-serialize', () => {
  it('emptyState is a valid single-paragraph root', () => {
    const s = emptyState()
    expect(isSerializedState(s)).toBe(true)
    expect(s.root.children).toHaveLength(1)
    expect(isEmptyState(s)).toBe(true)
  })

  it('round-trips a Lexical JSON string verbatim (the stored form)', () => {
    const json = lexical('Hello world')
    const state = toEditorState(json)
    expect(isSerializedState(state)).toBe(true)
    // fromEditorState(toEditorState(x)) is structurally equal to x
    expect(JSON.parse(fromEditorState(state))).toEqual(JSON.parse(json))
    expect(toPlainText(json)).toBe('Hello world')
    expect(isEmptyState(json)).toBe(false)
  })

  it('wraps a legacy plain-text body in one paragraph (migration, never throws)', () => {
    const state = toEditorState('An old plain body from the Text field')
    expect(isSerializedState(state)).toBe(true)
    expect(toPlainText(state)).toBe('An old plain body from the Text field')
    expect(isEmptyState(state)).toBe(false)
  })

  it('empty / null / whitespace → empty document (isEmptyState true)', () => {
    for (const v of ['', '   ', null, undefined]) {
      expect(isEmptyState(v)).toBe(true)
      expect(toPlainText(v)).toBe('')
      expect(isSerializedState(toEditorState(v))).toBe(true)
    }
  })

  it('malformed JSON string falls back to plain-text wrap (no throw)', () => {
    const broken = '{ "root": not json'
    const state = toEditorState(broken)
    expect(isSerializedState(state)).toBe(true)
    // the whole broken string becomes the paragraph text (honest, editable)
    expect(toPlainText(state)).toContain('root')
  })

  it('accepts an already-parsed state object', () => {
    const obj = JSON.parse(lexical('parsed'))
    expect(toEditorState(obj)).toBe(obj)
    expect(toPlainText(obj)).toBe('parsed')
  })

  it('isSerializedState rejects non-states', () => {
    expect(isSerializedState(null)).toBe(false)
    expect(isSerializedState('str')).toBe(false)
    expect(isSerializedState({})).toBe(false)
    expect(isSerializedState({ root: {} })).toBe(false)
    expect(isSerializedState({ root: { children: [] } })).toBe(true)
  })

  it('toPlainText collapses whitespace across nested nodes', () => {
    const nested = JSON.stringify({
      root: {
        type: 'root',
        children: [
          { type: 'heading', tag: 'h1', children: [{ type: 'text', text: 'Title' }] },
          { type: 'paragraph', children: [{ type: 'text', text: 'Body one' }, { type: 'text', text: ' two' }] },
        ],
        direction: null, format: '', indent: 0, version: 1,
      },
    })
    expect(toPlainText(nested)).toBe('Title Body one two')
  })
})
