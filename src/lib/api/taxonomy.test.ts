import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

/**
 * The catalogue read must not be cached across identities.
 *
 * The response varies by ORG (the platform's rows plus your own, never another
 * customer's) and by WRITE AUTHORITY (a staged row reaches only whoever can
 * unstage it). So two callers hitting the same URL are owed different documents,
 * and anything this module remembered between them would be served to the wrong
 * one — one tenant's rows in another tenant's console.
 *
 * READ AS SOURCE, not imported, for the reason `taxonomy.test.ts` next door gives
 * about the registry: the failure being caught is a mistake in THIS file, and
 * importing it would only prove something about a value, not about the text a
 * person will edit next. A cache is added by typing a `let` at the top of a
 * module; this reads for that.
 *
 * It is deliberately about MODULE-SCOPE state. A `const` table, a type, the
 * fetch itself are all fine — what is refused is somewhere to put an answer.
 */
const SOURCE = readFileSync(join(__dirname, 'taxonomy.ts'), 'utf8')

/** Lines outside any block — module scope is what survives between callers. */
const moduleScope = (src: string): string[] => {
  const out: string[] = []
  let depth = 0
  let block = false
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '')
    const trimmed = line.trim()
    if (block) {
      if (trimmed.includes('*/')) block = false
      continue
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) block = true
      continue
    }
    if (depth === 0 && trimmed) out.push(trimmed)
    depth += (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length
  }
  return out
}

describe('the catalogue read holds nothing between callers', () => {
  const top = moduleScope(SOURCE)

  it('declares no mutable module-scope binding', () => {
    // `let x` / `var x` at module scope is the shape every accidental cache takes.
    expect(top.filter((l) => /^(export\s+)?(let|var)\s/.test(l))).toEqual([])
  })

  it('keeps no module-scope store to put an answer in', () => {
    expect(top.filter((l) => /new (Map|Set|WeakMap|WeakRef)\b/.test(l))).toEqual([])
  })

  it('does not park a response in web storage, which outlives the session', () => {
    // sessionStorage survives a sign-out into the NEXT sign-in in the same tab.
    expect(SOURCE).not.toMatch(/sessionStorage|localStorage|indexedDB/)
  })

  it('narrows by brand on the wire rather than filtering again here', () => {
    // The server applies the brand scope; a second copy here is a rule with two
    // homes, and they drift.
    expect(SOURCE).toContain('?brand=')
    expect(SOURCE).not.toMatch(/\.filter\(/)
  })
})
