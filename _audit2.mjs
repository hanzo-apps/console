// Commerce+Platform visual+API audit — console.hanzo.ai as z@hanzo.ai.
// Desktop (1440) + mobile (390): screenshots, horizontal overflow, console errors,
// captured /v1|/billing|/commerce|/cloud|/paas XHR statuses, clickable-row heuristics.
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'https://console.hanzo.ai'
const EMAIL = process.env.AUDIT_EMAIL ?? 'z@hanzo.ai'
const PASSWORD = process.env.AUDIT_PASSWORD ?? 'IloveHanzo2026!!'
const OUT = process.env.OUT ?? '/tmp/claude-1000/-home-z-work-hanzo/424b9001-24e5-4788-9a52-bf3052b1ec14/scratchpad/audit2'
mkdirSync(OUT, { recursive: true })
mkdirSync(`${OUT}/shots`, { recursive: true })

// The 12-module surface + their tabs. slug -> label.
const ROUTES = (process.env.ONLY ? process.env.ONLY.split(',') : [
  'billing', 'billing/reports', 'billing/budgets', 'billing/invoices',
  'billing/subscriptions', 'billing/payment-methods', 'billing/credits',
  'plans', 'wallet',
  'products', 'orders', 'customers', 'inventory', 'promotions', 'store',
  'applications', 'builds', 'releases', 'pipelines', 'functions', 'dns',
])

const slug = (r) => r.replace(/\//g, '_')
const track = /\/(v1|billing|commerce|cloud|paas|ai|vm|tasksd)\//

async function login(page) {
  await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="Email"]', { timeout: 30000 })
  const em = page.locator('input[placeholder="Email"]')
  await em.click(); await em.pressSequentially(EMAIL, { delay: 20 })
  const pw = page.locator('input[placeholder="Password"]')
  await pw.click(); await pw.pressSequentially(PASSWORD, { delay: 20 })
  await page.waitForTimeout(400)
  await page.locator('button:has-text("Sign in")').first().click({ timeout: 30000 })
  const base = new URL(BASE).origin
  // Land on any authenticated route (home OR wherever it redirects), not strictly '/'.
  await page.waitForURL((u) => u.origin === base && !/\/(signin|auth)/.test(u.pathname), { timeout: 45000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)
}

async function auditRoute(ctx, route, vw, vh) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: vw, height: vh })
  const errors = []
  const calls = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 180)) })
  page.on('pageerror', (e) => errors.push('PAGEERR ' + String(e).slice(0, 180)))
  page.on('response', (resp) => {
    try {
      const u = new URL(resp.url())
      if (u.origin === new URL(BASE).origin && track.test(u.pathname)) {
        calls.push({ m: resp.request().method(), p: u.pathname + (u.search ? u.search.slice(0, 40) : ''), s: resp.status() })
      }
    } catch { /* ignore */ }
  })
  let status = 0
  try {
    const resp = await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    status = resp ? resp.status() : 0
  } catch (e) { errors.push('GOTO ' + String(e).slice(0, 100)) }
  await page.waitForTimeout(4000)
  const info = await page.evaluate(() => {
    const de = document.documentElement
    const overflowPx = Math.max(0, de.scrollWidth - de.clientWidth)
    const pointer = Array.from(document.querySelectorAll('*')).filter((el) => getComputedStyle(el).cursor === 'pointer').length
    const buttons = document.querySelectorAll('button, [role="button"]').length
    // Text of the main content area if we can find it, else body.
    const main = document.querySelector('main') || document.body
    const text = (main.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 900)
    return { overflowPx, pointer, buttons, text }
  })
  const file = `${OUT}/shots/${slug(route)}__${vw}.png`
  await page.screenshot({ path: file, fullPage: true })
  await page.close()
  // De-dup calls.
  const seen = new Set(); const uniq = []
  for (const c of calls) { const k = `${c.m} ${c.p} ${c.s}`; if (!seen.has(k)) { seen.add(k); uniq.push(c) } }
  return { route, vw, status, overflowPx: info.overflowPx, pointerEls: info.pointer, buttons: info.buttons, calls: uniq.slice(0, 12), errors: errors.slice(0, 5), text: info.text }
}

const run = async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  try {
    await login(page)
    console.log('LOGIN_OK ' + page.url())
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
      const errs = r.calls.filter((c) => c.s >= 400).map((c) => `${c.s} ${c.p}`).join('; ')
      console.log(`${route} @${vw} http=${r.status} overflow=${r.overflowPx} btns=${r.buttons} err=${r.errors.length} bad=[${errs}]`)
    }
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2))
  console.log('DONE ' + results.length + ' -> ' + OUT)
  await browser.close()
}
run()
