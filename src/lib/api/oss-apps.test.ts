import { describe, it, expect } from 'vitest'

import {
  normalizeOssApp,
  normalizeOssApps,
  blueprintBase,
  logoUrl,
  ownerRepo,
  claimPath,
  type OssApp,
} from './oss-apps'

const raw2fauth = {
  id: '2fauth',
  name: '2FAuth',
  description: 'A web app to manage your Two-Factor Authentication (2FA) accounts',
  version: 'latest',
  logo: 'logo.svg',
  links: { github: 'https://github.com/Bubka/2FAuth', website: 'https://2fauth.app', docs: 'https://docs.2fauth.app' },
  tags: ['productivity'],
  dokploy_version: '1.2.3', // an extra field the console must silently drop
}

describe('normalizeOssApp', () => {
  it('maps the live meta.json shape and drops unknown fields', () => {
    const app = normalizeOssApp(raw2fauth)
    expect(app).toEqual<OssApp>({
      id: '2fauth',
      name: '2FAuth',
      description: 'A web app to manage your Two-Factor Authentication (2FA) accounts',
      version: 'latest',
      logo: 'logo.svg',
      tags: ['productivity'],
      links: { github: 'https://github.com/Bubka/2FAuth', website: 'https://2fauth.app', docs: 'https://docs.2fauth.app' },
    })
    // dokploy_version is not carried through
    expect(Object.keys(app!)).not.toContain('dokploy_version')
  })

  it('defaults version to "latest", tolerates missing/blank optional fields', () => {
    const app = normalizeOssApp({ id: 'x', name: 'X', logo: '', links: {} })
    expect(app).toMatchObject({ id: 'x', name: 'X', version: 'latest', logo: '', tags: [], description: '' })
    expect(app!.links).toEqual({ github: undefined, website: undefined, docs: undefined })
  })

  it('falls back name → id, drops a record with no id', () => {
    expect(normalizeOssApp({ id: 'only-id' })?.name).toBe('only-id')
    expect(normalizeOssApp({ name: 'no id' })).toBeNull()
    expect(normalizeOssApp(null)).toBeNull()
    expect(normalizeOssApp('nope')).toBeNull()
  })
})

describe('normalizeOssApps', () => {
  it('reads a bare array and de-dupes repeated ids (first wins)', () => {
    const apps = normalizeOssApps([raw2fauth, { ...raw2fauth, name: 'DUP' }, { id: 'ackee', name: 'Ackee', links: {} }])
    expect(apps.map((a) => a.id)).toEqual(['2fauth', 'ackee'])
    expect(apps[0].name).toBe('2FAuth') // first wins over the later DUP
  })

  it('reads a wrapped payload and rejects garbage → []', () => {
    expect(normalizeOssApps({ data: [{ id: 'a', name: 'A', links: {} }] }).map((a) => a.id)).toEqual(['a'])
    expect(normalizeOssApps({ nope: 1 })).toEqual([])
    expect(normalizeOssApps(null)).toEqual([])
    expect(normalizeOssApps('x')).toEqual([])
  })
})

describe('URL builders', () => {
  it('blueprintBase + logoUrl resolve the per-app CDN path', () => {
    expect(blueprintBase('https://templates.hanzo.ai/', '2fauth')).toBe('https://templates.hanzo.ai/blueprints/2fauth')
    expect(logoUrl('https://templates.hanzo.ai', normalizeOssApp(raw2fauth)!)).toBe(
      'https://templates.hanzo.ai/blueprints/2fauth/logo.svg',
    )
  })

  it('logoUrl is null when no logo filename (→ card monogram fallback)', () => {
    expect(logoUrl('https://x', normalizeOssApp({ id: 'a', name: 'A', logo: '', links: {} })!)).toBeNull()
  })
})

describe('ownerRepo + claimPath (the maker "Earn 20%" hook)', () => {
  it('derives owner/repo and strips a trailing .git', () => {
    expect(ownerRepo('https://github.com/Bubka/2FAuth')).toBe('Bubka/2FAuth')
    expect(ownerRepo('https://github.com/n8n-io/n8n.git')).toBe('n8n-io/n8n')
    expect(ownerRepo('https://github.com/a/b/tree/main')).toBe('a/b')
  })

  it('returns null for a non-GitHub / missing url', () => {
    expect(ownerRepo('https://gitlab.com/a/b')).toBeNull()
    expect(ownerRepo(undefined)).toBeNull()
    expect(ownerRepo('')).toBeNull()
  })

  it('claimPath routes in-console to /authors with a URL-safe ?claim= hint', () => {
    expect(claimPath(normalizeOssApp(raw2fauth)!)).toBe('/authors?claim=Bubka%2F2FAuth')
    expect(claimPath(normalizeOssApp({ id: 'a', name: 'A', links: {} })!)).toBe('/authors')
  })
})
