import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SERVED, labelOf, lineOf, nameOf, serves } from './served'

/**
 * One fact, one place — held from both ends.
 *
 * The catalogue is two halves that meet in `catalog`: what the platform serves
 * (`served.data.json`, written by `scripts/sync-catalog.mjs` from the description
 * document) and what a person declares about the console surface over it. The
 * failure this file exists to make impossible is a row that answers a question the
 * platform already answered — the shape the registry had for years, where 186 rows
 * typed a name and a line for a catalogue the platform owns, and the two drifted
 * quietly because nothing ever compared them.
 *
 * Both directions are failures, and only one of them is obvious:
 *   • a row typing a description the platform publishes is the second copy;
 *   • a row typing NONE where the platform publishes none renders a blank line.
 * A console-only surface — a view over several services, an operator board, a
 * launch tile — is the legitimate case for typing one, and there are plenty: those
 * pages must keep working, so the rule is "not twice", never "not here".
 *
 * READ AS SOURCE, NOT IMPORTED, for the reason its siblings give: the registry
 * cannot be loaded in vitest at all (icon ESM), and a fixture mirroring the real
 * rows proves nothing about the file that ships.
 */
const SRC = readFileSync(join(__dirname, 'registry.tsx'), 'utf8')

/** Every shipped row, reduced to what it typed about its own name and line. */
const rows = (): { id: string; label?: string; description: boolean }[] => {
  const out: { id: string; label?: string; description: boolean }[] = []
  for (const block of SRC.split(/^ {2}\{$/m).slice(1)) {
    const body = block.split(/^ {2}\},?$/m)[0]
    const id = (body.match(/^ {4}id: '([^']+)',$/m) ?? [])[1]
    if (!id) continue
    out.push({
      id,
      label: (body.match(/^ {4}label: '(.*)',$/m) ?? [])[1],
      description: /^ {4}description: /m.test(body),
    })
  }
  return out
}

describe('the record the platform writes', () => {
  it('carries products, each with the operations that prove it exists', () => {
    const ids = Object.keys(SERVED)
    expect(ids.length).toBeGreaterThan(100)
    for (const id of ids) expect(SERVED[id].operations).toBeGreaterThan(0)
  })

  it('answers whether a product exists — the id IS the /v1 segment', () => {
    expect(serves('dns')).toBe(true)
    expect(serves('lux-explorer')).toBe(false)
  })
})

describe('the projection', () => {
  it('reads an id as a name, and yields to a row that spells its own', () => {
    expect(nameOf('machines')).toBe('Machines')
    expect(nameOf('api-keys')).toBe('Api Keys') // the plain rule gets an acronym wrong, so that row spells it
    expect(labelOf({ id: 'api-keys', label: 'API Keys' })).toBe('API Keys')
    expect(labelOf({ id: 'machines' })).toBe('Machines')
  })

  it("prefers the platform's line and falls back to the row's own", () => {
    expect(lineOf({ id: 'dns', description: 'ignored' })).toBe(SERVED.dns.description)
    expect(lineOf({ id: 'lux-explorer', description: 'Browse the chain.' })).toBe('Browse the chain.')
  })
})

describe('the shipped catalogue', () => {
  const catalogue = rows()

  it('is every row, each addressed once', () => {
    expect(catalogue.length).toBeGreaterThan(150)
    expect(new Set(catalogue.map((r) => r.id)).size).toBe(catalogue.length)
  })

  it('never types a description the platform publishes', () => {
    const copies = catalogue.filter((r) => r.description && SERVED[r.id]?.description).map((r) => r.id)
    expect(copies, `these rows repeat what /v1/openapi.json already says: ${copies.join(', ')}`).toEqual([])
  })

  it('always has a line to render — its own where the platform writes none', () => {
    const mute = catalogue.filter((r) => !r.description && !SERVED[r.id]?.description).map((r) => r.id)
    expect(mute, `these rows would render a blank line: ${mute.join(', ')}`).toEqual([])
  })

  it('never types a label its own id already spells', () => {
    const echoes = catalogue.filter((r) => r.label !== undefined && r.label === nameOf(r.id)).map((r) => r.id)
    expect(echoes, `these labels repeat their id: ${echoes.join(', ')}`).toEqual([])
  })
})
