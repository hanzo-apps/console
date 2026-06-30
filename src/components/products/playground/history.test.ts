import { describe, it, expect } from 'vitest'

import { pushRun, type HistoryEntry } from './history'

const entry = (id: string): HistoryEntry => ({
  id,
  at: 1,
  mode: 'chat',
  system: '',
  user: 'q',
  columns: [],
})

describe('pushRun — newest first, capped', () => {
  it('prepends onto an empty list', () => {
    expect(pushRun([], entry('a')).map((e) => e.id)).toEqual(['a'])
  })

  it('prepends newest first', () => {
    const list = pushRun([entry('a')], entry('b'))
    expect(list.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('caps the list length, dropping the oldest', () => {
    const list = pushRun([entry('a'), entry('b'), entry('c')], entry('d'), 2)
    expect(list.map((e) => e.id)).toEqual(['d', 'a'])
    expect(list.length).toBe(2)
  })
})
