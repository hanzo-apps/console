import { describe, it, expect } from 'vitest'

import { buildRequestBody, toCurl, toJson, GATEWAY_URL } from './request-preview'
import { paramsOf } from './params'
import { DEFAULT_SETTINGS } from './types'

const msgs = [{ role: 'user', content: 'hi' }]

describe('buildRequestBody — only the params that are set', () => {
  it('includes model, messages, temperature and top_p always', () => {
    const body = buildRequestBody('zen-omni', msgs, paramsOf(DEFAULT_SETTINGS))
    expect(body.model).toBe('zen-omni')
    expect(body.messages).toEqual(msgs)
    expect(body.temperature).toBe(0.7)
    expect(body.top_p).toBe(0.9)
    expect(body.max_tokens).toBe(1024)
  })

  it('omits unset advanced params (no fabricated zeros)', () => {
    const body = buildRequestBody('m', msgs, paramsOf(DEFAULT_SETTINGS))
    expect('frequency_penalty' in body).toBe(false)
    expect('presence_penalty' in body).toBe(false)
    expect('seed' in body).toBe(false)
  })

  it('includes advanced params when set', () => {
    const body = buildRequestBody('m', msgs, paramsOf({ ...DEFAULT_SETTINGS, presencePenalty: 0.5, seed: '7', stop: 'END' }))
    expect(body.presence_penalty).toBe(0.5)
    expect(body.seed).toBe(7)
    expect(body.stop).toEqual(['END'])
  })
})

describe('toCurl / toJson — runnable + readable', () => {
  it('cURL carries the gateway URL, bearer placeholder and the JSON body', () => {
    const curl = toCurl(buildRequestBody('zen-omni', msgs, paramsOf(DEFAULT_SETTINGS)))
    expect(curl).toContain(GATEWAY_URL)
    expect(curl).toContain('Authorization: Bearer $HANZO_API_KEY')
    expect(curl).toContain('"model":"zen-omni"')
  })

  it('JSON is pretty-printed', () => {
    const json = toJson(buildRequestBody('m', msgs, paramsOf(DEFAULT_SETTINGS)))
    expect(json).toContain('\n  "model": "m"')
  })
})
