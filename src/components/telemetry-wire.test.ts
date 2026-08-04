/**
 * The telemetry wire — pins what `TelemetrySurface` (Analytics.tsx) actually
 * configures, so the ONE front door and the error plane cannot silently regress.
 *
 * This asserts the CLIENT half in a plain Node env (the suite convention: stub the
 * browser globals a test needs, mock `fetch`). The React mount is one line in
 * Analytics.tsx; what is worth pinning is that the client it builds emits a
 * pageview to `POST https://api.hanzo.ai/v1/event` as `product: 'console'`, carries
 * the console's IAM bearer, and resolves the hanzo-console Sentry DSN from the
 * product name alone — no `dsn` prop, no env var.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTelemetry } from '@hanzogui/telemetry'

type FetchCall = { url: string; init: RequestInit }

let calls: FetchCall[]

beforeEach(() => {
  calls = []
  const store = new Map<string, string>()
  const listeners = () => {}
  const win = {
    location: { hostname: 'console.hanzo.ai', search: '', href: 'https://console.hanzo.ai/' },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    addEventListener: listeners,
    removeEventListener: listeners,
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('localStorage', win.localStorage)
  vi.stubGlobal('document', { referrer: '', visibilityState: 'visible', addEventListener: listeners })
  // No DNT/GPC — the consent-refused path is the telemetry package's own test.
  vi.stubGlobal('navigator', { doNotTrack: undefined, userAgent: 'test' })
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') })
  })
})

afterEach(() => vi.unstubAllGlobals())

/** Exactly how `TelemetrySurface` builds it: product + the IAM PKCE bearer. */
const consoleTelemetry = (token: string | null = 'iam-access-token') =>
  createTelemetry({ product: 'console', getToken: () => token })

describe('console telemetry wire', () => {
  it('POSTs a pageview to the ONE front door as product=console', () => {
    const t = consoleTelemetry()
    expect(t.enabled).toBe(true)
    expect(t.product).toBe('console')

    t.pageview('/')
    t.flush()

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.hanzo.ai/v1/event')

    const body = JSON.parse(String(calls[0].init.body))
    const pv = body.batch.find((e: { type: string }) => e.type === 'pageview')
    expect(pv).toBeTruthy()
    expect(pv.product).toBe('console')
    expect(pv.path).toBe('/')
  })

  it('carries the IAM access token as a Bearer', () => {
    const t = consoleTelemetry('iam-access-token')
    t.pageview('/')
    t.flush()

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer iam-access-token')
  })

  it('still emits when signed out (no token, no crash)', () => {
    const t = consoleTelemetry(null)
    t.pageview('/signin')
    t.flush()

    expect(calls).toHaveLength(1)
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('resolves the hanzo-console Sentry DSN from `product` alone', () => {
    // The reason @hanzo/event was bumped to ^0.3.4: the DSN registry landed in
    // 0.3.x, so declaring the product is what lights up sentry.hanzo.ai. A regression
    // here means the console's errors silently stop reaching the dashboard.
    const t = consoleTelemetry()
    expect(t.client.errorPlaneEnabled).toBe(true)
    expect(t.client.errorIngestUrl).toContain('api.hanzo.ai/v1/sentry/')
  })

  it('identify binds a person id on the one stream', () => {
    const t = consoleTelemetry()
    t.identify('hanzo/z')
    t.flush()

    const body = JSON.parse(String(calls[0].init.body))
    const id = body.batch.find((e: { type: string }) => e.type === 'identify')
    expect(id).toBeTruthy()
    expect(id.personId).toBe('hanzo/z')
  })
})
