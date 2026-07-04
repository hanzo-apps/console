import { describe, expect, it } from 'vitest'

import { apexFromDocs, apiBaseFromDocs, landingDocsUrl, standardResources, supportMailto } from './logic'

describe('apexFromDocs', () => {
  it('strips scheme, path, and the docs. prefix', () => {
    expect(apexFromDocs('https://docs.hanzo.ai')).toBe('hanzo.ai')
    expect(apexFromDocs('https://docs.lux.network/foo')).toBe('lux.network')
    expect(apexFromDocs('https://docs.zoo.ngo')).toBe('zoo.ngo')
    expect(apexFromDocs('http://docs.pars.network/')).toBe('pars.network')
  })
})

describe('apiBaseFromDocs', () => {
  it('builds the brand /v1 API base', () => {
    expect(apiBaseFromDocs('https://docs.hanzo.ai')).toBe('https://api.hanzo.ai/v1')
    expect(apiBaseFromDocs('https://docs.lux.network')).toBe('https://api.lux.network/v1')
  })
})

describe('landingDocsUrl', () => {
  it('joins the /docs/ product path and optional sub-path (no double slash)', () => {
    expect(landingDocsUrl('https://docs.hanzo.ai', 'embeddings')).toBe('https://docs.hanzo.ai/docs/embeddings')
    expect(landingDocsUrl('https://docs.hanzo.ai/', 'embeddings', 'quickstart')).toBe('https://docs.hanzo.ai/docs/embeddings/quickstart')
  })
})

describe('supportMailto', () => {
  it('derives the brand support mailbox', () => {
    expect(supportMailto('https://docs.hanzo.ai')).toBe('mailto:support@hanzo.ai')
    expect(supportMailto('https://docs.zoo.ngo')).toBe('mailto:support@zoo.ngo')
  })
})

describe('standardResources', () => {
  it('returns the real docs/quickstart/examples/api links for a product', () => {
    expect(standardResources('https://docs.hanzo.ai', 'embeddings')).toEqual({
      docs: 'https://docs.hanzo.ai/docs/embeddings',
      quickstart: 'https://docs.hanzo.ai/docs/embeddings',
      examples: 'https://docs.hanzo.ai/docs/embeddings',
      api: 'https://docs.hanzo.ai/docs/api',
    })
  })
})
