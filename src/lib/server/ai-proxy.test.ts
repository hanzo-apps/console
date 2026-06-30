import { describe, expect, it } from 'vitest'

import { retrievalHeaders, FORWARDED_HEADERS } from './ai-proxy'

/** A Headers-like lookup from a case-insensitive map. */
const getter = (entries: Record<string, string>) => {
  const lower = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]))
  return (name: string) => lower.get(name.toLowerCase()) ?? null
}

describe('retrievalHeaders', () => {
  it('passes through the RAG retrieval switch when present', () => {
    const get = getter({ 'X-Retrieval': '1', 'X-Retrieval-Store': 'docs' })
    expect(retrievalHeaders(get)).toEqual({ 'X-Retrieval': '1', 'X-Retrieval-Store': 'docs' })
  })

  it('forwards nothing for a plain chat (no retrieval headers)', () => {
    expect(retrievalHeaders(getter({ Authorization: 'Bearer x' }))).toEqual({})
  })

  it('omits an unset header rather than forwarding an empty value', () => {
    expect(retrievalHeaders(getter({ 'X-Retrieval': '1' }))).toEqual({ 'X-Retrieval': '1' })
  })

  it('never forwards a header outside the allow-list', () => {
    const get = getter({ 'X-Org-Id': 'evil', Cookie: 'leak', 'X-Retrieval': '1' })
    const out = retrievalHeaders(get)
    expect(Object.keys(out)).toEqual(['X-Retrieval'])
    for (const k of Object.keys(out)) expect(FORWARDED_HEADERS).toContain(k as never)
  })
})
