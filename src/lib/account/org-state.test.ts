import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { contextLabel, scopedOrgRow } from './org-state'

describe('scopedOrgRow', () => {
  it('titles a slug when IAM gave no display name', () => {
    expect(scopedOrgRow({ name: 'acme' }).at(0)?.displayName).toBe('Acme')
    expect(scopedOrgRow({ name: 'acme' }).at(0)?.name).toBe('acme')
  })

  it('carries the resolved identity, so the row cannot disagree with the trigger', () => {
    // The trigger reads `orgLabel(org)`; the row must read the same words and wear
    // the same mark. It used to re-derive both from the slug — "Hanzo AI" above a
    // row saying "Hanzo", a logo above a monogram.
    const org = { name: 'hanzo', displayName: 'Hanzo AI', logo: 'https://x/logo.svg' }
    const row = scopedOrgRow(org).at(0)
    expect(row?.displayName).toBe('Hanzo AI')
    expect(row?.logo).toBe('https://x/logo.svg')
    expect(row?.name).toBe('hanzo')
  })

  it('is honest when nothing is scoped yet', () => {
    expect(scopedOrgRow({ name: '' })).toEqual([])
    expect(scopedOrgRow({})).toEqual([])
  })
})

describe('contextLabel', () => {
  it('reads org alone at org-level scope', () => {
    expect(contextLabel('Hanzo')).toBe('Hanzo')
    expect(contextLabel('Hanzo', undefined)).toBe('Hanzo')
  })

  it('reads org / project once a project is chosen', () => {
    expect(contextLabel('Hanzo', 'atlas')).toBe('Hanzo / atlas')
  })
})

/** Every .ts/.tsx under src/, so the scan cannot miss a new caller. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('the one org switch', () => {
  /**
   * THE money-path invariant. `org-scope.switchOrg` persists the scope and
   * reloads, so every module refetches under the new `X-Org-Id` — the one seam
   * tenant scoping and its billing attribution hang off. A second switcher
   * elsewhere would bypass it silently, and a UI with the org in two corners is
   * exactly how that creeps in. So this asserts the STRUCTURE: precisely one
   * component calls it.
   */
  it('has exactly these call sites, and no other', () => {
    const root = join(import.meta.dirname, '../..')
    // REACHING it, not calling it. The switcher is `@hanzo/ui/product`'s now and
    // takes the whole active-org contract as ONE value, so the console binds
    // `switchOrg` into that value and the call happens inside the shared
    // component. A scan for `switchOrg(` would watch the wrong thing twice over:
    // it would report the one control that still owns the switch as having let
    // go of it, and it would not see a second component that imported the same
    // function and handed it away. Importing it is what reaching it means; the
    // prose that names it in a comment reaches nothing.
    const reaches = (src: string) =>
      /import \{[^}]*\bswitchOrg\b[^}]*\} from '~\/lib\/org-scope'/.test(src) ||
      /export function switchOrg\b/.test(src)
    const callers = sources(root)
      .filter((p) => reaches(readFileSync(p, 'utf8')))
      .map((p) => p.slice(root.length + 1))
      .sort()
    expect(callers).toEqual([
      // The command palette can jump you to a tenant — a search result, not a
      // corner of the chrome, so it costs the IA nothing.
      'components/CommandPalette.tsx',
      // The ONE persistent org control in the shell.
      'components/ContextSwitcher.tsx',
      // The definition itself.
      'lib/org-scope.ts',
    ])
  })

  it('is imported from org-scope by every caller, never redefined', () => {
    const root = join(import.meta.dirname, '../..')
    for (const rel of ['components/ContextSwitcher.tsx', 'components/CommandPalette.tsx']) {
      const src = readFileSync(join(root, rel), 'utf8')
      expect(src, rel).toMatch(/import \{[^}]*\bswitchOrg\b[^}]*\} from '~\/lib\/org-scope'/)
      expect(src, rel).not.toMatch(/function switchOrg|const switchOrg\s*=/)
    }
  })
})
