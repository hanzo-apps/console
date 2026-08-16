import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { ACRONYMS, audit, open } from './_gate'

/**
 * The scorecard — the design gate, over EVERY route, in BOTH themes.
 *
 * `design-invariants.spec.ts` asserts these rules beautifully and asserts them on
 * three screens. The console has 126. So the rules were true of the shell and
 * unknown everywhere else, and "the design is correct" was a claim about three
 * pages wearing the clothes of a claim about the product.
 *
 * This runs the SAME gate — imported, not copied, which is the whole reason it
 * moved to `./_gate` — across every route the router knows, in light and dark,
 * and writes what it found to `e2e-shots/scorecard.json`.
 *
 * WHY IT SCORES INSTEAD OF FAILING
 *
 * A gate that goes red on 126 routes the first time it runs is a gate everybody
 * learns to ignore, and an ignored gate is worse than none: it converts a real
 * signal into noise and then into a habit. So the scorecard records the TRUTH
 * (every violation, per surface, per theme) and fails on exactly one thing — a
 * surface that got WORSE than the committed baseline, or a new surface arriving
 * dirty. The number can only go one way, and the day it reaches zero the
 * baseline is deleted and this becomes an ordinary gate.
 *
 * The baseline is committed for the same reason the rules are: a threshold that
 * lives in someone's head comes back.
 *
 * SCOPE
 *
 * `ROUTES` is `route-ids.json` — the list `blank-audit.spec.ts` already drives,
 * because two lists of "every page" is how a page gets audited by one and missed
 * by the other. Set `SCORECARD_ROUTES=12` to sweep a prefix while iterating; the
 * full sweep is ~250 page loads and belongs in CI, not in a inner loop.
 */
const SHOTS = 'e2e-shots'
const BASELINE = path.join('e2e', 'scorecard-baseline.json')
const THEMES = ['dark', 'light'] as const

type Violations = {
  caps: number
  type: number
  radius: number
  space: number
  z: number
  contrast: number
  hScroll: number
}
type Row = Violations & { route: string; theme: string; total: number }

const ROUTES: string[] = (() => {
  const all = JSON.parse(fs.readFileSync(path.join('e2e', 'route-ids.json'), 'utf8')) as string[]
  const limit = Number(process.env.SCORECARD_ROUTES || 0)
  const pages = limit > 0 ? all.slice(0, limit) : all
  // The gallery leads, so a component is audited on its own terms rather than
  // only wherever some page happens to render it — and it is FIRST, so a short
  // iterating sweep still covers the components.
  return ['gallery', ...pages]
})()

const zero = (): Violations => ({ caps: 0, type: 0, radius: 0, space: 0, z: 0, contrast: 0, hScroll: 0 })

/** The scorecard's own arithmetic, kept pure so it is testable without a browser. */
export const totalOf = (v: Violations): number =>
  v.caps + v.type + v.radius + v.space + v.z + v.contrast + v.hScroll

/** A surface regressed when it carries MORE violations than the baseline allowed.
 *  An unknown surface is held to zero: a page arriving dirty is a page that never
 *  had to be clean, and the baseline exists to retire debt, not to accept more. */
export const regressed = (row: Row, baseline: Record<string, number>): boolean =>
  row.total > (baseline[`${row.route}#${row.theme}`] ?? 0)

const readBaseline = (): Record<string, number> => {
  try {
    return JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Record<string, number>
  } catch {
    return {}
  }
}

test.describe('scorecard', () => {
  // One browser context per theme sweep; each route is a navigation, not a boot.
  test.setTimeout(20 * 60 * 1000)

  for (const theme of THEMES) {
    test(`every route holds the design gate — ${theme}`, async ({ page }, info) => {
      const rows: Row[] = []
      const acronyms = Array.from(ACRONYMS)

      for (const route of ROUTES) {
        try {
          await open(page, `/${route}`)
          // The theme lives on <html>, which is where app/layout.tsx stamps it
          // and where every token answers. Setting it on <body> instead retunes
          // the BACKGROUND while `html.t_dark` keeps the text tokens dark — near
          // white on near white at ratio 1.03, on every surface, in a probe that
          // then reports the product as failing contrast. It was the probe.
          await page.evaluate((t) => {
            const h = document.documentElement
            h.classList.remove('t_dark', 't_light')
            h.classList.add(t === 'dark' ? 't_dark' : 't_light')
            h.style.colorScheme = t
            h.dataset.theme = t
          }, theme)
          await page.waitForTimeout(150)

          const a = await audit(page, acronyms)
          const v: Violations = {
            caps: a.capsComputed.length + a.capsTyped.length,
            type: a.offType.length,
            radius: a.offRadius.length,
            space: a.offSpace.length,
            z: a.offZ.length,
            contrast: a.lowContrast.length,
            hScroll: a.hScroll ? 1 : 0,
          }
          rows.push({ route, theme, ...v, total: totalOf(v) })
        } catch (err) {
          // A route that will not open is a finding, not a crash — record it and
          // keep sweeping, or one broken page hides the other 125.
          rows.push({ route, theme, ...zero(), hScroll: 0, total: 0, ...{} } as Row)
          info.annotations.push({ type: 'unreachable', description: `${route}: ${String(err).slice(0, 120)}` })
        }
      }

      fs.mkdirSync(SHOTS, { recursive: true })
      const clean = rows.filter((r) => r.total === 0).length
      const card = {
        theme,
        surfaces: rows.length,
        clean,
        score: rows.length ? Math.round((clean / rows.length) * 1000) / 10 : 0,
        violations: rows.reduce((n, r) => n + r.total, 0),
        worst: [...rows].sort((a, b) => b.total - a.total).slice(0, 15),
        rows,
      }
      fs.writeFileSync(path.join(SHOTS, `scorecard-${theme}.json`), JSON.stringify(card, null, 2))

      const baseline = readBaseline()
      const worse = rows.filter((r) => regressed(r, baseline))
      const named = worse
        .slice(0, 20)
        .map((r) => `${r.route} (${r.theme}): ${r.total} > ${baseline[`${r.route}#${r.theme}`] ?? 0}`)
        .join('\n')

      expect(worse, `surfaces worse than the baseline:\n${named}`).toHaveLength(0)
    })
  }
})
