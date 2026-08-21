import { describe, expect, it } from 'vitest'

import { CAP, compose, example, subjectOf, type Entry, type Op, type Subject } from './compose'

const op = (name: string, method: string, path: string, summary?: string): Op => ({
  name,
  method,
  path,
  summary,
})

/** An ARBITRARY product — not one the console ships. Nothing branches on the id. */
const subject = (over: Partial<Subject> = {}): Subject => ({
  id: 'widget',
  label: 'Widget',
  description: 'Package widget is the thing this fixture invented.',
  category: 'Fixtures',
  route: '/widget',
  pages: ['Overview', 'Settings', 'Logs'],
  base: 'https://api.hanzo.ai',
  ops: [],
  ...over,
})

describe('compose', () => {
  it('derives a brief for a product the console has never heard of', () => {
    const text = compose(
      subject({
        ops: [
          op('get_widget', 'GET', '/v1/widget', 'List widgets'),
          op('post_widget', 'POST', '/v1/widget', 'Make a widget'),
        ],
      }),
    )
    expect(text).toContain('# Widget')
    expect(text).toContain('Package widget is the thing this fixture invented.')
    expect(text).toContain('`/widget` — Overview · Settings · Logs')
    expect(text).toContain('### Operations (2)')
    expect(text).toContain('- `get_widget` — `GET /v1/widget` — List widgets')
    expect(text).toContain('- `post_widget` — `POST /v1/widget` — Make a widget')
  })

  it('names the base without a version segment, so base + an absolute path is not doubled', () => {
    const text = compose(subject({ ops: [op('get_widget', 'GET', '/v1/widget')] }))
    expect(text).toContain('`https://api.hanzo.ai`')
    // The operations print absolute paths; a reader joining the two as written
    // must land on one /v1, never /v1/v1.
    expect(text).not.toContain('`https://api.hanzo.ai/v1`')
    expect(text).not.toMatch(/\/v1\/v1|\/api\/v1|\/v2\b/)
  })

  it('asks for a bearer and points at the console page that mints one', () => {
    const text = compose(subject())
    expect(text).toContain('Authorization: Bearer <your token>')
    expect(text).toContain('`/api-keys`')
  })

  it('carries no credential, for any input', () => {
    const text = compose(subject({ ops: [op('get_widget', 'GET', '/v1/widget', 'List widgets')] }))
    expect(text).not.toMatch(/\bsk-|\bpk-|\bhk-/)
    expect(text).not.toMatch(/kms:\/\//i)
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{16,}/)
  })

  it('says only what it knows when the product answers no operations', () => {
    const text = compose(subject())
    expect(text).toContain('answers no operations under `/v1/widget`')
    expect(text).not.toContain('### Operations')
    expect(text).not.toContain('### Example')
    expect(text).toContain('https://api.hanzo.ai/v1/openapi/commands (service `widget`)')
  })

  it('summarizes honestly past the cap instead of dumping every line', () => {
    const many = Array.from({ length: CAP + 7 }, (_, i) => op(`get_widget_${i}`, 'GET', `/v1/widget/${i}`))
    const text = compose(subject({ ops: many }))
    expect(text).toContain(`### Operations (${CAP + 7})`)
    expect(text).toContain('… 7 more at https://api.hanzo.ai/v1/openapi/commands')
    expect(text.split('\n').filter((l) => l.startsWith('- `get_widget_'))).toHaveLength(CAP)
  })

  it('leads every operation with the name it is called by', () => {
    const text = compose(subject({ ops: [op('get_widget', 'GET', '/v1/widget')] }))
    expect(text).toContain('Each is addressed by its name.')
    expect(text).toContain('- `get_widget` — `GET /v1/widget`')
  })

  it('includes the docs link only when the record carries one', () => {
    expect(compose(subject({ docs: 'https://docs.hanzo.ai/docs/widget' }))).toContain(
      '- Docs: https://docs.hanzo.ai/docs/widget',
    )
    expect(compose(subject())).not.toContain('- Docs:')
  })
})

describe('subjectOf', () => {
  // The whole point: a product nobody wrote a brief for still gets one. Add an entry
  // to the catalog and this yields its brief — there is no per-product branch to add.
  const entry: Entry = {
    id: 'sprocket',
    label: 'Sprocket',
    description: 'Package sprocket is a product invented by this test.',
    category: 'Fixtures',
    docs: 'https://docs.hanzo.ai/docs/sprocket',
  }

  it('maps any entry to a brief carrying its own operations', () => {
    const text = compose(
      subjectOf(entry, ['Overview', 'Status'], 'https://api.hanzo.ai', [
        op('get_sprocket', 'GET', '/v1/sprocket', 'List sprockets'),
      ]),
    )
    expect(text).toContain('# Sprocket')
    expect(text).toContain('Package sprocket is a product invented by this test.')
    expect(text).toContain('- Console: `/sprocket` — Overview · Status')
    expect(text).toContain('- Docs: https://docs.hanzo.ai/docs/sprocket')
    expect(text).toContain('- `get_sprocket` — `GET /v1/sprocket` — List sprockets')
    expect(text).toContain('curl -s https://api.hanzo.ai/v1/sprocket')
    expect(text).toContain('(service `sprocket`)')
  })

  it('takes the console address from the id, so a new entry needs no route written down', () => {
    expect(subjectOf({ ...entry, id: 'cog' }, [], 'https://api.hanzo.ai', []).route).toBe('/cog')
  })
})

describe('example', () => {
  it('picks the shortest parameter-free read, so it runs as written', () => {
    const curl = example('https://api.hanzo.ai', [
      op('a', 'GET', '/v1/widget/:id'),
      op('b', 'GET', '/v1/widget/settings'),
      op('c', 'GET', '/v1/widget'),
      op('d', 'POST', '/v1/widget'),
    ])
    expect(curl).toBe(
      'curl -s https://api.hanzo.ai/v1/widget \\\n  -H "Authorization: Bearer $TOKEN"',
    )
  })

  it('invents nothing when every read needs a value the brief does not have', () => {
    expect(
      example('https://api.hanzo.ai', [op('a', 'GET', '/v1/widget/:id'), op('b', 'POST', '/v1/widget')]),
    ).toBeUndefined()
    expect(example('https://api.hanzo.ai', [op('a', 'GET', '/v1/widget/{id}')])).toBeUndefined()
  })
})
