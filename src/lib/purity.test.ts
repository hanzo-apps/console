import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * One substrate, asserted.
 *
 * This console renders through `@hanzo/gui` primitives on the `@hanzo/tokens`
 * scale, with components from `@hanzo/ui` on top. There is no Tailwind, no
 * Radix, no shadcn, no cva — and the point of this file is that "there is no"
 * stays true without anyone re-checking it.
 *
 * An audit found the tree already clean. An audit is a measurement of a moment;
 * a dependency arrives in a branch nobody reads twice, and the first sign is a
 * utility class that does nothing because no build step ever compiled it — the
 * failure is SILENT, which is what makes it worth a test rather than a habit.
 *
 * It reads SOURCE TEXT deliberately. The rules here are about what the repo may
 * contain, not about what a page computes; the browser-side half of the same
 * question is `e2e/_gate.ts`, which measures what actually painted.
 */

const ROOT = path.resolve(__dirname, '..', '..')
const DIRS = ['src', 'app']

/** Packages whose presence would mean a second styling system. */
const FORBIDDEN_DEPS = [
  /^tailwindcss$/,
  /^@tailwindcss\//,
  /^tailwind-merge$/,
  /^@radix-ui\//,
  /^class-variance-authority$/,
  /^clsx$/,
  /^cmdk$/,
  /^sonner$/,
  /shadcn/,
]

/**
 * Class prefixes this repo owns. A class token outside these is either a
 * utility from a framework we do not build (so it is dead text pretending to
 * style something) or a bare global name that collides with whatever else
 * claims it — the `hz-pulse` collision is what taught us the second half.
 */
const OURS = /^(hz-|pg-|t_|glass$|elevation-\d|voice-)/

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!/node_modules|\.next|dist/.test(p)) walk(p, out)
    } else if (/\.(tsx?|css)$/.test(e.name)) out.push(p)
  }
  return out
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)))
const read = (f: string) => fs.readFileSync(f, 'utf8')
const rel = (f: string) => path.relative(ROOT, f)

describe('one substrate', () => {
  it('declares no second styling system', () => {
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json'))) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    const found = deps.filter((d) => FORBIDDEN_DEPS.some((re) => re.test(d)))
    expect(found, `these bring a styling system we do not build: ${found.join(', ')}`).toEqual([])
  })

  it('has no Tailwind build, so a utility class could only be dead text', () => {
    const configs = fs
      .readdirSync(ROOT)
      .filter((f) => /^(tailwind|postcss)\.config\./.test(f))
    expect(configs, `found ${configs.join(', ')}`).toEqual([])
  })

  it('imports nothing from a framework we do not render through', () => {
    const bad: string[] = []
    for (const f of files) {
      const m = read(f).match(
        /from ['"](@radix-ui\/[^'"]+|cmdk|sonner|class-variance-authority|clsx|tailwind-merge)['"]/g,
      )
      if (m) bad.push(`${rel(f)}: ${m.join(', ')}`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('writes no @tailwind or @apply directive', () => {
    const bad = files.filter((f) => /\.css$/.test(f) && /@tailwind\b|@apply\b/.test(read(f))).map(rel)
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('uses only class names this repo defines', () => {
    const foreign = new Map<string, string>()
    for (const f of files) {
      if (/\.css$/.test(f)) continue
      for (const m of read(f).matchAll(/className=["'`]([^"'`]+)["'`]/g)) {
        for (const tok of m[1].split(/\s+/).filter(Boolean)) {
          // A template hole (`${...}`) is a value, not a literal class.
          if (tok.includes('$')) continue
          if (!OURS.test(tok) && !foreign.has(tok)) foreign.set(tok, rel(f))
        }
      }
    }
    const listed = [...foreign].map(([t, f]) => `${t}  (${f})`)
    expect(listed, `class names outside this repo's own prefixes:\n${listed.join('\n')}`).toEqual([])
  })
})
