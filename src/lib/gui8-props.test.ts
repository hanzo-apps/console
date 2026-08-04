import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

import { describe, it, expect } from 'vitest'

import { findGui8Violations } from './gui8-props'

const REPO = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Every file that can actually render a gui element — i.e. that imports one.
 *
 * Scoping by import is what makes the rule precise rather than merely loud. A gui prop
 * only means anything in a file holding a gui component, so a `{ tag: 'v1' }` image tag
 * in a pure-logic module is out of scope by construction — and so is this rule module
 * and its own fixtures, which name the banned spellings as data and import no gui.
 */
function guiSources(...roots: string[]): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(path)) {
        const text = readFileSync(path, 'utf8')
        if (/from '@hanzo\/(gui|ui)/.test(text)) out.push({ path, text })
      }
    }
  }
  for (const root of roots) walk(join(REPO, root))
  return out
}

describe('findGui8Violations', () => {
  it('catches the tag="a" that shipped two dead links', () => {
    const found = findGui8Violations('<XStack tag="a" href={href}>')
    expect(found).toHaveLength(1)
    expect(found[0].rule.instead).toBe('render')
  })

  it('catches the object-spread form too', () => {
    expect(findGui8Violations("const link = { tag: 'a', href }")).toHaveLength(1)
  })

  it('accepts the gui 8 spelling', () => {
    expect(findGui8Violations('<XStack render="a" href={href}>')).toEqual([])
    expect(findGui8Violations("const link = { render: 'a' as const, href }")).toEqual([])
  })

  it('catches animation, $gt* and a bare lineHeight ratio', () => {
    expect(findGui8Violations('<View animation="quick" />')).toHaveLength(1)
    expect(findGui8Violations('<View $gtSm={{ p: 8 }} />')).toHaveLength(1)
    expect(findGui8Violations('<Text lineHeight={1.1}>')).toHaveLength(1)
  })

  it('leaves the gui 8 spellings of those alone', () => {
    expect(findGui8Violations('<View transition="quick" $sm={{ p: 8 }} />')).toEqual([])
  })

  it('does not ban a lineHeight that is a real px length', () => {
    expect(findGui8Violations('<Text lineHeight={22}>')).toEqual([])
  })

  it('does not fire inside a comment that names the banned prop', () => {
    expect(findGui8Violations('  // `render`, not `tag="a"`: gui 8 renamed it.')).toEqual([])
  })
})

describe('does not fire on a `tag` that is data, not a host element', () => {
  it('leaves an image tag alone', () => {
    expect(findGui8Violations("const image = { tag: 'v1' }")).toEqual([])
    expect(findGui8Violations("expect(app.tag).toBe('v8.4.149')")).toEqual([])
  })
})

describe('the console source', () => {
  const files = guiSources('app', 'src')

  it('scans the real gui surface', () => {
    expect(files.length).toBeGreaterThan(300)
  })

  it('uses no gui 7 prop that gui 8 would silently drop', () => {
    const bad = files.flatMap(({ path, text }) =>
      findGui8Violations(text).map(
        (v) => `${relative(REPO, path)}:${v.line}  ${v.match}  -> renders ${v.rule.renders}; use \`${v.rule.instead}\``,
      ),
    )
    expect(bad).toEqual([])
  })
})
