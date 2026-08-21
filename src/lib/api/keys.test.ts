import { describe, expect, it } from 'vitest'

import { partitionKeys } from './keys'

/**
 * The wire shape, copied from a live `GET /v1/account/keys` against an account that holds
 * three publishable keys and no secret. THIS is the body the page rendered "create
 * your first key" over: `canonical-paths.test.ts` pinned the URL and never the body,
 * so nothing noticed that the read dropped every row it found.
 */
const LIVE = {
  keys: [
    { type: 'publishable', prefix: 'pk-live-7ad', key: 'pk-live-7ad384e90719fa', createdAt: '2026-08-08T11:33:36Z' },
    { type: 'publishable', prefix: 'pk-live-e09', key: 'pk-live-e096d9c3659d99', createdAt: '2026-08-02T21:25:53Z' },
    { type: 'publishable', prefix: 'pk-live-348', key: 'pk-live-3489a31d546129', createdAt: '2026-08-06T20:36:38Z' },
  ],
}

describe('partitionKeys — two shapes, reported separately', () => {
  it('reports all three publishable keys when the account holds no secret', () => {
    const { secret, publishable } = partitionKeys(LIVE)
    expect(secret).toBeUndefined()
    expect(publishable).toHaveLength(3)
    expect(publishable.map((k) => k.key)).toEqual([
      'pk-live-7ad384e90719fa',
      'pk-live-e096d9c3659d99',
      'pk-live-3489a31d546129',
    ])
    expect(publishable[0].createdAt).toBe('2026-08-08T11:33:36Z')
  })

  // The distinction is the point: `sk-` resolves to the USER, `pk-` only to the ORG.
  // Folding them together would make a browser-safe key look session-equivalent.
  it('never counts a publishable key as the secret', () => {
    expect(partitionKeys(LIVE).secret).toBeUndefined()
  })

  it('picks the secret out of a mixed listing without losing the publishable ones', () => {
    const { secret, publishable } = partitionKeys({
      keys: [
        { type: 'publishable', prefix: 'pk-live-7ad', key: 'pk-live-7ad384e90719fa' },
        { type: 'secret', prefix: 'sk-live-abc', createdAt: '2026-08-01T00:00:00Z' },
      ],
    })
    expect(secret?.prefix).toBe('sk-live-abc')
    expect(publishable.map((k) => k.prefix)).toEqual(['pk-live-7ad'])
  })

  // Cloud reads an omitted `type` as the secret; that default must not silently
  // swallow a publishable row, nor promote one.
  it('treats a row with no type as the secret, as cloud does', () => {
    expect(partitionKeys({ keys: [{ prefix: 'sk-live-abc' }] }).secret?.prefix).toBe('sk-live-abc')
  })

  it('derives the 11-char prefix when only the full value came back', () => {
    const { publishable } = partitionKeys({ keys: [{ type: 'publishable', key: 'pk-live-7ad384e90719fa' }] })
    expect(publishable[0].prefix).toBe('pk-live-7ad')
  })

  it('accepts a bare array as well as the {keys:[…]} envelope', () => {
    const rows = [{ type: 'publishable', key: 'pk-live-1', prefix: 'pk-live-1' }]
    expect(partitionKeys(rows).publishable).toHaveLength(1)
  })

  it('reads an empty / absent / malformed listing as nothing held, never as a throw', () => {
    for (const body of [{ keys: [] }, {}, null, undefined, 'nonsense', 42]) {
      const { secret, publishable } = partitionKeys(body)
      expect(secret).toBeUndefined()
      expect(publishable).toEqual([])
    }
  })

  it('drops a row carrying neither a value nor a prefix rather than listing a blank', () => {
    expect(partitionKeys({ keys: [{ type: 'publishable' }] }).publishable).toEqual([])
  })
})
