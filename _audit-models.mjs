// Models-suite visual audit — console.hanzo.ai, logged in as z@hanzo.ai.
// Screenshots each model surface at 1440 (desktop) + 390 (mobile), measures
// horizontal overflow, captures console errors + a text sample + interactive
// heuristics (pointer els, buttons). Also snapshots a model-detail click-through.
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'https://console.hanzo.ai'
const EMAIL = process.env.AUDIT_EMAIL ?? 'z@hanzo.ai'
const PASSWORD = process.env.AUDIT_PASSWORD ?? 'IloveHanzo2026!!'
const OUT = process.env.OUT ?? '/tmp/claude-1000/-home-z-work-hanzo/424b9001-24e5-4788-9a52-bf3052b1ec14/scratchpad/models-audit'
mkdirSync(OUT, { recursive: true })

const ROUTES = (process.env.ONLY ? process.env.ONLY.split(',') : [
  'models', 'models/routing',
  'inference', 'inference/status', 'inference/logs', 'inference/metrics',
  'embeddings', 'embeddings/explore', 'embeddings/collections', 'embeddings/jobs',
  'embeddings/models', 'embeddings/settings',
  'playground',
])

const slug = (r) => r.replace(/\//g, '_')

async function login(page) {
  await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="Email"]', { timeout: 30000 })
  const em = page.locator('input[placeholder="Email"]')
  await em.click(); await em.pressSequentially(EMAIL, { delay: 15 })
  const pw = page.locator('input[placeholder="Password"]')
  await pw.click(); await pw.pressSequentially(PASSWORD, { delay: 15 })
  await page.waitForTimeout(300)
  await page.locator('button:has-text("Sign in")').first().click({ timeout: 30000 })
  const base = new URL(BASE).origin
  await page.waitForURL((u) => u.origin === base && (u.pathname === '/' || u.pathname === ''), { timeout: 45000 })
  await page.waitForLoadState('domcontentloaded')
}

async function auditRoute(ctx, route, vw, vh) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: vw, height: vh })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errors.push('PAGEERR ' + String(e).slice(0, 200)))
  let status = 0
  try {
    const resp = await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    status = resp ? resp.status() : 0
  } catch (e) { errors.push('GOTO ' + String(e).slice(0, 120)) }
  await page.waitForTimeout(4000)
  const info = await page.evaluate(() => {
    const de = document.documentElement
    const overflowPx = Math.max(0, de.scrollWidth - de.clientWidth)
    const pointer = Array.from(document.querySelectorAll('*')).filter((el) => getComputedStyle(el).cursor === 'pointer').length
    const buttons = document.querySelectorAll('button, [role="button"]').length
    const rows = document.querySelectorAll('[data-row], tr').length
    const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1600)
    return { overflowPx, pointer, buttons, rows, text }
  })
  const file = `${OUT}/${slug(route)}__${vw}.png`
  await page.screenshot({ path: file, fullPage: true })
  await page.close()
  return { route, vw, status, overflowPx: info.overflowPx, pointerEls: info.pointer, buttons: info.buttons, errors: errors.slice(0, 8), textSample: info.text, file }
}

// Special: on the Models catalog, click the first table row → capture the detail panel.
async function auditDetail(ctx, vw, vh) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: vw, height: vh })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERR ' + String(e).slice(0, 200)))
  try {
    await page.goto(`${BASE}/models`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(4500)
    // The catalog rows are hoverable XStacks with cursor:pointer inside the DataTable.
    // Click the first row that looks like a model row (has a provider logo + price).
    const clicked = await page.evaluate(() => {
      const cand = Array.from(document.querySelectorAll('*')).filter((el) => {
        const s = getComputedStyle(el)
        return s.cursor === 'pointer' && el.textContent && /\$|context|Available|Catalog/i.test(el.textContent)
      })
      // pick the first reasonably-sized row
      const row = cand.find((el) => el.getBoundingClientRect().height > 30 && el.getBoundingClientRect().width > 300)
      if (row) { row.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true }
      return false
    })
    await page.waitForTimeout(2500)
    const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200))
    const file = `${OUT}/models_DETAIL__${vw}.png`
    await page.screenshot({ path: file, fullPage: true })
    await page.close()
    return { route: 'models(detail-click)', vw, clicked, textSample: txt, file, errors }
  } catch (e) {
    await page.close()
    return { route: 'models(detail-click)', vw, error: String(e).slice(0, 200) }
  }
}

const run = async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  try {
    await login(page)
    console.log('LOGIN_OK')
  } catch (e) {
    console.log('LOGIN_FAIL ' + String(e).slice(0, 300))
    await page.screenshot({ path: `${OUT}/_login_fail.png`, fullPage: true }).catch(() => {})
    await browser.close(); process.exit(2)
  }
  await page.close()
  const results = []
  for (const route of ROUTES) {
    for (const [vw, vh] of [[1440, 900], [390, 844]]) {
      const r = await auditRoute(ctx, route, vw, vh)
      results.push(r)
      console.log(`${route} @${vw} status=${r.status} overflow=${r.overflowPx}px pointerEls=${r.pointerEls} buttons=${r.buttons} err=${r.errors.length}${r.errors.length ? ' :: ' + r.errors[0] : ''}`)
    }
  }
  for (const [vw, vh] of [[1440, 900], [390, 844]]) {
    const d = await auditDetail(ctx, vw, vh)
    results.push(d)
    console.log(`models(detail) @${vw} clicked=${d.clicked} ${d.error ?? ''}`)
  }
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results, null, 2))
  console.log('DONE ' + results.length + ' shots -> ' + OUT)
  await browser.close()
}
run()
