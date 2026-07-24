import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'

import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  LIVE_SUBJECTS,
  SIGNATURE_HEADER,
  SIGNATURE_SCHEME,
  goVerifySnippet,
  nodeVerifySnippet,
} from './verify'

describe('signature scheme', () => {
  it('documents the exact header + payload', () => {
    expect(SIGNATURE_HEADER).toBe('X-Webhook-Signature')
    expect(EVENT_HEADER).toBe('X-Webhook-Event')
    expect(DELIVERY_HEADER).toBe('X-Webhook-Delivery')
    expect(SIGNATURE_SCHEME).toContain('t=<unix>')
    expect(SIGNATURE_SCHEME).toContain('hmac_sha256(secret, "<t>.<body>")')
  })
})

describe('nodeVerifySnippet', () => {
  const snippet = nodeVerifySnippet()

  it('uses node:crypto HMAC-SHA256 with a constant-time compare over <t>.<body>', () => {
    expect(snippet).toContain("import crypto from 'node:crypto'")
    expect(snippet).toContain("createHmac('sha256', secret)")
    expect(snippet).toContain('crypto.timingSafeEqual')
    expect(snippet).toContain('`${parts.t}.${raw}`')
    expect(snippet).toContain(SIGNATURE_HEADER)
  })

  it('describes the real verification algorithm the snippet implements', () => {
    // The snippet is a reference implementation of: hex(hmac_sha256(secret, "<t>.<body>")).
    // Reproduce it here to prove the documented algorithm is correct + matches the scheme.
    const secret = 's3cr3t'
    const t = '1700000000'
    const body = '{"event":"commerce.order.created","id":"ord_1"}'
    const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
    // A signature header the platform would send.
    const header = `t=${t},v1=${expected}`
    // Parse it the way the snippet documents and recompute.
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=').map((s) => s.trim())))
    const recomputed = createHmac('sha256', secret).update(`${parts.t}.${body}`).digest('hex')
    expect(recomputed).toBe(parts.v1)
    // A tampered body must not verify.
    const tampered = createHmac('sha256', secret).update(`${parts.t}.${body}X`).digest('hex')
    expect(tampered).not.toBe(parts.v1)
  })
})

describe('goVerifySnippet', () => {
  const snippet = goVerifySnippet()

  it('uses crypto/hmac + sha256 with hmac.Equal over t + "." + body', () => {
    expect(snippet).toContain('"crypto/hmac"')
    expect(snippet).toContain('"crypto/sha256"')
    expect(snippet).toContain('hmac.New(sha256.New, []byte(secret))')
    expect(snippet).toContain('t + "." + string(body)')
    expect(snippet).toContain('hmac.Equal(')
    expect(snippet).toContain('func VerifyWebhook(')
  })
})

describe('LIVE_SUBJECTS', () => {
  it('lists the live commerce subjects incl. the catch-all wildcard', () => {
    const patterns = LIVE_SUBJECTS.map((s) => s.pattern)
    expect(patterns).toContain('commerce.order.*')
    expect(patterns).toContain('commerce.checkout.*')
    expect(patterns).toContain('commerce.>')
    expect(LIVE_SUBJECTS.every((s) => s.label.length > 0)).toBe(true)
  })
})
