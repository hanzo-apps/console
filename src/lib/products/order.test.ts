import { describe, it, expect } from 'vitest'

import { sortAlpha, orderEntries } from './order'

const e = (id: string, label: string) => ({ id, label })

describe('sortAlpha', () => {
  it('sorts by label, case-insensitively, without mutating the input', () => {
    const input = [e('b', 'Vector'), e('a', 'agents'), e('c', 'Models')]
    const out = sortAlpha(input)
    expect(out.map((x) => x.id)).toEqual(['a', 'c', 'b']) // agents, Models, Vector
    expect(input.map((x) => x.id)).toEqual(['b', 'a', 'c']) // input untouched
  })
})

describe('orderEntries', () => {
  const list = [e('models', 'Models'), e('agents', 'Agents'), e('vector', 'Vector'), e('chat', 'Chat')]

  it('is plain alphabetical with no selection', () => {
    expect(orderEntries(list).map((x) => x.id)).toEqual(['agents', 'chat', 'models', 'vector'])
  })

  it('pins the selected item first, rest stay alphabetical', () => {
    expect(orderEntries(list, 'vector').map((x) => x.id)).toEqual(['vector', 'agents', 'chat', 'models'])
  })

  it('is plain alphabetical when the selected id is absent', () => {
    expect(orderEntries(list, 'nope').map((x) => x.id)).toEqual(['agents', 'chat', 'models', 'vector'])
  })

  it('leaves order unchanged when the selected item is already first alphabetically', () => {
    expect(orderEntries(list, 'agents').map((x) => x.id)).toEqual(['agents', 'chat', 'models', 'vector'])
  })
})
