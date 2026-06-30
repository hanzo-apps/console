import { describe, it, expect } from 'vitest'

import { pushSaved, type SavedPrompt } from './prompts'

const p = (id: string): SavedPrompt => ({ id, name: id, model: 'zen-omni', system: '', user: 'q', at: 1 })

describe('pushSaved — newest first, de-duplicated by id, capped', () => {
  it('prepends onto an empty list', () => {
    expect(pushSaved([], p('a')).map((x) => x.id)).toEqual(['a'])
  })

  it('prepends newest first', () => {
    expect(pushSaved([p('a')], p('b')).map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('de-duplicates by id (re-saving moves it to the front, no duplicate)', () => {
    const list = pushSaved([p('a'), p('b')], p('a'))
    expect(list.map((x) => x.id)).toEqual(['a', 'b'])
    expect(list.length).toBe(2)
  })

  it('caps the list length, dropping the oldest', () => {
    const list = pushSaved([p('a'), p('b'), p('c')], p('d'), 2)
    expect(list.map((x) => x.id)).toEqual(['d', 'a'])
  })
})
