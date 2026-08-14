/**
 * The greeting, rendered.
 *
 * The unit tests pin the string; this pins that the string reaches the page with
 * the account's real name in it and no orphaned punctuation — the two things that
 * only go wrong once a session, a theme and a hydration pass are involved.
 */
import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'

import { primeSession } from './_session'

const OUT = process.env.SHOT_DIR ?? '/home/z/Desktop/redesign/greeting'

const VERBS = ['compounding', 'building', 'shipping', 'hacking', 'scheming', 'launching', 'tinkering']

test('greets the person by the name they answer to', async ({ page }) => {
  mkdirSync(OUT, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await primeSession(page, { displayName: 'Zach Kelling', name: 'z', owner: 'hanzo' })
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const heading = page.getByText(/^Good (compounding|building|shipping|hacking|scheming|launching|tinkering)/)
  await expect(heading).toBeVisible({ timeout: 60_000 })

  const line = (await heading.first().textContent())?.trim() ?? ''

  // The first name, not the record.
  expect(line).toContain('Zach')
  expect(line, 'the surname belongs in the account, not the greeting').not.toContain('Kelling')

  // A verb the list actually owns, and no orphaned comma.
  expect(VERBS.some((v) => line.startsWith(`Good ${v}, `))).toBe(true)
  expect(line.endsWith(',')).toBe(false)

  await page.screenshot({ path: `${OUT}/greeting-desktop.png`, clip: { x: 260, y: 60, width: 900, height: 120 } })
})

test('says something sensible when the account has no name', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await primeSession(page, { displayName: '', name: '', owner: 'hanzo' })
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const heading = page.getByText(/^Good [a-z]+/)
  await expect(heading).toBeVisible({ timeout: 60_000 })
  const line = (await heading.first().textContent())?.trim() ?? ''

  // "Good building, " with nothing after it is the bug worth a test.
  expect(line).not.toMatch(/,\s*$/)
})
