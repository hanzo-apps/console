import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { pushRun, loadHistory, saveRun, clearHistory, type HistoryEntry } from './history'

const entry = (id: string): HistoryEntry => ({
  id,
  at: 1,
  mode: 'chat',
  system: '',
  user: 'q',
  columns: [{ model: 'zen-omni', ok: true, promptTokens: 1, completionTokens: 1, totalUsd: 0, ttftMs: 1, totalMs: 1 }],
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

/** A minimal in-memory localStorage (matches the org-scope test convention). */
function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('history storage — per user, auto-persisted', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = { localStorage: fakeStorage() }
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('saves a run and reloads it for the same user', () => {
    expect(loadHistory('dave@x.com')).toEqual([])
    saveRun('dave@x.com', entry('r1'))
    expect(loadHistory('dave@x.com').map((e) => e.id)).toEqual(['r1'])
  })

  it('isolates one user’s history from another on the same browser', () => {
    saveRun('dave@x.com', entry('r1'))
    saveRun('z@hanzo.ai', entry('r2'))
    expect(loadHistory('dave@x.com').map((e) => e.id)).toEqual(['r1'])
    expect(loadHistory('z@hanzo.ai').map((e) => e.id)).toEqual(['r2'])
  })

  it('clears only the targeted user', () => {
    saveRun('dave@x.com', entry('r1'))
    saveRun('z@hanzo.ai', entry('r2'))
    clearHistory('dave@x.com')
    expect(loadHistory('dave@x.com')).toEqual([])
    expect(loadHistory('z@hanzo.ai').map((e) => e.id)).toEqual(['r2'])
  })

  it('falls back to a shared anon bucket for an empty user key', () => {
    saveRun('', entry('r1'))
    expect(loadHistory('   ').map((e) => e.id)).toEqual(['r1'])
  })
})
