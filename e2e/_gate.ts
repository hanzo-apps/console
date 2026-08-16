/**
 * The design gate, as ONE definition.
 *
 * These rules were written for three states and are true of every screen the
 * console has. They lived inside `design-invariants.spec.ts`, so the only way to
 * apply them to another surface was to copy them — and a copied rule is how a
 * page gets checked by one spec and missed by another, which is the exact defect
 * class the rules themselves exist to catch.
 *
 * So the probe and the four scales live here, and the specs are the callers:
 * `design-invariants` runs them over the shell's states, and `scorecard` runs
 * them over every route in both themes. One gate, two questions.
 *
 * Everything below runs INSIDE the page and reads what PAINTED — never what the
 * source says. A rule asserted against source text is a rule about a file; these
 * are about a screen.
 */
import { expect, type Page } from '@playwright/test'

import { primeSession } from './_session'

/** Genuine acronyms — capitalised because that is how they are spelled. */
export const ACRONYMS = new Set([
  'AI', 'ML', 'LLM', 'API', 'SDK', 'IDE', 'CLI', 'CDN', 'DNS', 'DNSSEC', 'TTL', 'CIDR', 'VPC',
  'IAM', 'KMS', 'HSM', 'MPC', 'SSO', 'MFA', 'TOTP', 'OIDC', 'PKCE', 'JWT', 'CSRF', 'SAFE',
  'CPU', 'GPU', 'GPUS', 'RAM', 'SSD', 'VRAM', 'PVC', 'S3', 'KV', 'SQL', 'URL', 'URI', 'JSON',
  'HTTP', 'HTTPS', 'POST', 'CNAME', 'AAAA', 'P95', 'P99', 'MRR', 'SKU', 'OSS', 'CRM', 'ERP',
  'CMS', 'RAG', 'OTEL', 'OTLP', 'RED', 'ZIP', 'PDF', 'CSV', 'ID', 'IDS', 'UI', 'UX', 'WCAG',
])

/** The ONE type scale (gui.config.ts FONT_SIZE + app/design/typography.css). */
export const TYPE = new Set([11, 13, 14, 15, 17, 21, 26, 32, 40, 48])
/** The ONE radius scale: control · input/row · panel · pill. */
export const RADIUS = new Set([0, 6, 8, 12, 9999, 100000])
/** The ONE spacing ramp (gui.config.ts STEP). */
export const SPACE = new Set([0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208])
/** The ladder in app/design/z.css — the only stacking values that may paint. */
export const Z = new Set([10, 200, 300, 400, 500, 600, 700, 800])

type Audit = {
  capsComputed: string[]
  capsTyped: string[]
  offType: { size: number; text: string }[]
  offRadius: { radius: number; cls: string }[]
  offSpace: { pad: number; cls: string }[]
  offZ: { z: number; cls: string }[]
  lowContrast: { ratio: number; text: string; fg: string; bg: string }[]
  hScroll: boolean
  bodyBg: string
}

/** Runs entirely in the page: reads what PAINTED, never what the source says. */
export async function audit(page: Page, acronyms: string[]): Promise<Audit> {
  return page.evaluate((acr) => {
    const ACR = new Set(acr)
    const out: Audit = {
      capsComputed: [], capsTyped: [], offType: [], offRadius: [], offSpace: [],
      offZ: [], lowContrast: [], hScroll: false, bodyBg: '',
    }
    const TYPE = new Set([11, 13, 14, 15, 17, 21, 26, 32, 40, 48])
    const RADIUS = new Set([0, 6, 8, 12, 9999, 100000])
    const SPACE = new Set([0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208])
    const Z = new Set([10, 200, 300, 400, 500, 600, 700, 800])

    const cls = (el: Element) => (typeof el.className === 'string' ? el.className.slice(0, 90) : el.tagName)
    const px = (v: string) => Math.round(parseFloat(v) || 0)
    const rendered = (el: Element) => !!(el as HTMLElement).offsetParent || el === document.body

    // sRGB relative luminance → WCAG contrast ratio.
    const lum = (c: string) => {
      const m = c.match(/[\d.]+/g)
      if (!m || m.length < 3) return null
      if (m.length > 3 && parseFloat(m[3]) === 0) return null // fully transparent
      const [r, g, b] = m.slice(0, 3).map((n) => {
        const s = parseFloat(n) / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    /** The nearest ancestor that actually paints a background. */
    const bgOf = (el: Element): string => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const b = getComputedStyle(e).backgroundColor
        if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b
      }
      return getComputedStyle(document.body).backgroundColor
    }

    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.closest('nextjs-portal, [data-nextjs-toast], [aria-hidden="true"]')) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const leaf = el.children.length === 0
      const text = (el.textContent || '').trim()

      // 1 · caps
      if (cs.textTransform === 'uppercase' && leaf && text) out.capsComputed.push(text.slice(0, 48))

      // 2 · scales — only on nodes that actually paint
      if (rendered(el)) {
        const isMonogram = text.length <= 3 && !!el.closest('[data-monogram]')
        if (leaf && text && !isMonogram && !el.closest('svg')) {
          const s = px(cs.fontSize)
          if (!TYPE.has(s)) out.offType.push({ size: s, text: text.slice(0, 40) })
          // 5 · contrast, on the colours that painted
          const f = lum(cs.color)
          const b = lum(bgOf(el))
          if (f !== null && b !== null) {
            const ratio = (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05)
            const large = s >= 21 || (s >= 17 && Number(cs.fontWeight) >= 700)
            if (ratio < (large ? 3 : 4.5)) {
              out.lowContrast.push({ ratio: Math.round(ratio * 100) / 100, text: text.slice(0, 32), fg: cs.color, bg: bgOf(el) })
            }
          }
        }
        const r = px(cs.borderTopLeftRadius)
        if (r && !RADIUS.has(r)) out.offRadius.push({ radius: r, cls: cls(el) })
        for (const p of [cs.paddingLeft, cs.paddingTop]) {
          const v = px(p)
          if (v && !SPACE.has(v)) out.offSpace.push({ pad: v, cls: cls(el) })
        }
      }

      // 3 · stacking — only where a layer actually paints, only above a library's
      // own local ordering, and never the Gui portal host (see the header).
      const guiPortalHost = typeof el.className === 'string' && el.className.includes('_dsp_contents')
      if (cs.zIndex !== 'auto' && !guiPortalHost) {
        const z = Number(cs.zIndex)
        if (z > 10 && !Z.has(z)) out.offZ.push({ z, cls: cls(el) })
      }
    }

    // 1b · caps TYPED into a string
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = w.nextNode())) {
      if ((n.parentElement as HTMLElement | null)?.closest('nextjs-portal, [data-monogram]')) continue
      const s = (n.nodeValue || '').trim()
      if (s.length < 4 || !/^[A-Z][A-Z0-9 &/·—-]+$/.test(s) || !/[A-Z]{4,}/.test(s)) continue
      if (!s.split(/[^A-Z0-9]+/).every((p) => !p || ACR.has(p))) out.capsTyped.push(s.slice(0, 48))
    }

    out.hScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth
    out.bodyBg = getComputedStyle(document.body).backgroundColor
    return out
  }, acronyms)
}

/** Land on a dashboard route with a primed session and let the SPA settle. */
export async function open(page: Page, path: string): Promise<void> {
  await page.route('**/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[],"items":[],"status":"ok"}' }))
  await primeSession(page)
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav[aria-label="Products"]', { timeout: 45_000 }).catch(() => {})
  await page.waitForTimeout(6000)
}
