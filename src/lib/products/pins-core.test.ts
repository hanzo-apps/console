import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GROUP,
  addGroup,
  assign,
  groupedView,
  isPinned,
  move,
  normalizeModel,
  pin,
  pinnedFirst,
  removeGroup,
  renameGroup,
  toggle,
  unpin,
  type PinModel,
} from './pins-core'

const ids = (m: PinModel) => m.pins.map((p) => p.id)
const groupOf = (m: PinModel, id: string) => m.pins.find((p) => p.id === id)?.group

describe('normalizeModel', () => {
  it('migrates legacy favorites (string[]) as ungrouped, in order', () => {
    const m = normalizeModel({ legacy: ['models', 'chat', 'gpus'] })
    expect(ids(m)).toEqual(['models', 'chat', 'gpus'])
    expect(m.pins.every((p) => p.group === DEFAULT_GROUP)).toBe(true)
    expect(m.groups).toEqual([])
  })

  it('dedupes ids (first wins) and drops blanks', () => {
    const m = normalizeModel({ pins: [{ id: 'a', group: 'X' }, { id: 'a', group: 'Y' }, { id: '', group: '' }] })
    expect(ids(m)).toEqual(['a'])
    expect(groupOf(m, 'a')).toBe('X')
  })

  it('ensures a group referenced by a pin exists in groups', () => {
    const m = normalizeModel({ pins: [{ id: 'a', group: 'Infra' }] })
    expect(m.groups).toContain('Infra')
  })

  it('group-sorts pins so groups are contiguous (default bucket first)', () => {
    const m = normalizeModel({
      groups: ['Infra'],
      pins: [
        { id: 'a', group: 'Infra' },
        { id: 'b', group: '' },
        { id: 'c', group: 'Infra' },
      ],
    })
    // default '' bucket first, then Infra — contiguous
    expect(ids(m)).toEqual(['b', 'a', 'c'])
  })

  it('is idempotent', () => {
    const once = normalizeModel({ legacy: ['models', 'chat'] })
    const twice = normalizeModel({ pins: once.pins, groups: once.groups })
    expect(twice).toEqual(once)
  })
})

describe('pin / unpin / toggle', () => {
  const base = normalizeModel({ legacy: ['a', 'b'] })

  it('pin appends; is a no-op when already pinned', () => {
    const m = pin(base, 'c')
    expect(ids(m)).toEqual(['a', 'b', 'c'])
    expect(pin(m, 'c')).toBe(m)
  })

  it('unpin removes; no-op when absent', () => {
    expect(ids(unpin(base, 'a'))).toEqual(['b'])
    expect(unpin(base, 'zzz')).toBe(base)
  })

  it('toggle flips membership', () => {
    expect(isPinned(toggle(base, 'a'), 'a')).toBe(false)
    expect(isPinned(toggle(base, 'x'), 'x')).toBe(true)
  })
})

describe('move — reorder + regroup (one primitive)', () => {
  it('reorders within the default group', () => {
    const m = normalizeModel({ legacy: ['a', 'b', 'c'] })
    // move c to index 0
    expect(ids(move(m, 'c', DEFAULT_GROUP, 0))).toEqual(['c', 'a', 'b'])
    // move a to the end
    expect(ids(move(m, 'a', DEFAULT_GROUP, 2))).toEqual(['b', 'c', 'a'])
  })

  it('moves a pin into a (new) group and keeps groups contiguous', () => {
    const m = normalizeModel({ legacy: ['a', 'b', 'c'] })
    const g = move(m, 'b', 'Infra', 0)
    expect(groupOf(g, 'b')).toBe('Infra')
    expect(g.groups).toContain('Infra')
    // default bucket (a, c) first, then Infra bucket (b)
    expect(ids(g)).toEqual(['a', 'c', 'b'])
  })

  it('clamps an out-of-range index', () => {
    const m = normalizeModel({ legacy: ['a', 'b'] })
    expect(ids(move(m, 'a', DEFAULT_GROUP, 99))).toEqual(['b', 'a'])
    expect(ids(move(m, 'b', DEFAULT_GROUP, -5))).toEqual(['b', 'a'])
  })

  it('is a no-op for an unpinned id', () => {
    const m = normalizeModel({ legacy: ['a'] })
    expect(move(m, 'zzz', 'Infra', 0)).toBe(m)
  })

  it('assign appends to the end of the target group', () => {
    const m = normalizeModel({ groups: ['Infra'], pins: [{ id: 'a', group: 'Infra' }, { id: 'b', group: 'Infra' }, { id: 'c', group: '' }] })
    const g = assign(m, 'c', 'Infra')
    expect(g.pins.filter((p) => p.group === 'Infra').map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('groups', () => {
  it('addGroup creates an empty group; groupedView(includeEmpty) shows it', () => {
    const m = addGroup(normalizeModel({ legacy: ['a'] }), 'Infra')
    expect(m.groups).toEqual(['Infra'])
    const view = groupedView(m, true)
    expect(view.map((v) => v.name)).toEqual([DEFAULT_GROUP, 'Infra'])
    expect(view.find((v) => v.name === 'Infra')?.entries).toEqual([])
    // sidebar view (no empties) hides the empty group
    expect(groupedView(m, false).map((v) => v.name)).toEqual([DEFAULT_GROUP])
  })

  it('addGroup is a no-op for blank/default/duplicate', () => {
    const m = addGroup(normalizeModel({ legacy: ['a'] }), 'Infra')
    expect(addGroup(m, 'Infra')).toBe(m)
    expect(addGroup(m, '  ')).toBe(m)
  })

  it('removeGroup drops the group and un-groups its pins (still pinned)', () => {
    const m = move(normalizeModel({ legacy: ['a', 'b'] }), 'a', 'Infra', 0)
    const r = removeGroup(m, 'Infra')
    expect(r.groups).toEqual([])
    expect(isPinned(r, 'a')).toBe(true)
    expect(groupOf(r, 'a')).toBe(DEFAULT_GROUP)
  })

  it('renameGroup preserves order + pins; no-op on collision', () => {
    let m = addGroup(normalizeModel({ legacy: ['a'] }), 'Infra')
    m = move(m, 'a', 'Infra', 0)
    const r = renameGroup(m, 'Infra', 'Platform')
    expect(r.groups).toEqual(['Platform'])
    expect(groupOf(r, 'a')).toBe('Platform')
    // collision → no-op
    const two = addGroup(r, 'Data')
    expect(renameGroup(two, 'Platform', 'Data')).toBe(two)
  })
})

describe('groupedView — ordering', () => {
  it('default bucket first, then named groups in stored order', () => {
    const m = normalizeModel({
      groups: ['Infra', 'Data'],
      pins: [
        { id: 'x', group: '' },
        { id: 'y', group: 'Data' },
        { id: 'z', group: 'Infra' },
      ],
    })
    const view = groupedView(m)
    expect(view.map((v) => v.name)).toEqual(['', 'Infra', 'Data'])
    expect(view[0].label).toBe('Pinned')
  })
})

describe('pinnedFirst — one "pinned leads" rule, shared by the sidebar and search', () => {
  type Row = { id: string }
  const id = (r: Row) => r.id
  const rows: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('floats pinned items to the front in the USER\'s pin order, not the list order', () => {
    expect(pinnedFirst(rows, id, ['c', 'a']).map(id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('leaves the tail in the order it arrived, so search relevance still decides it', () => {
    expect(pinnedFirst(rows, id, ['d']).map(id)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('reorders — it never injects a pinned id the list does not contain', () => {
    const out = pinnedFirst(rows, id, ['zzz', 'b'])
    expect(out.map(id)).toEqual(['b', 'a', 'c', 'd'])
    expect(out).toHaveLength(rows.length)
  })

  it('is a no-op with no pins, or when nothing on the list is pinned', () => {
    expect(pinnedFirst(rows, id, [])).toBe(rows)
    expect(pinnedFirst(rows, id, ['nope'])).toBe(rows)
  })

  it('ignores items with no id (a sub-page result is never floated)', () => {
    const mixed = [{ id: '' }, { id: 'a' }, { id: '' }]
    expect(pinnedFirst(mixed, id, ['a']).map(id)).toEqual(['a', '', ''])
  })

  it('does not mutate the input', () => {
    const input = [{ id: 'a' }, { id: 'b' }]
    pinnedFirst(input, id, ['b'])
    expect(input.map(id)).toEqual(['a', 'b'])
  })
})
