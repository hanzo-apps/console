import { describe, it, expect } from 'vitest'

import {
  isCustomDomain,
  isId,
  isName,
  normalizeDeployment,
  normalizeProject,
  normalizeProjects,
  normalizeRoute,
  normalizeRoutes,
  normalizeScript,
  normalizeScripts,
  normalizeSubdomain,
  validateDomain,
  validateName,
  validatePattern,
  validateScript,
  validateZoneId,
  workersDevUrl,
} from './cloudflare'

const HEX32 = 'a'.repeat(32)

describe('name/id predicates mirror the backend regexes', () => {
  it('accepts a valid Cloudflare name segment', () => {
    for (const v of ['a', 'my-site', 'my_worker', 'site.v2', 'A1', 'x'.repeat(128)]) expect(isName(v)).toBe(true)
  })
  it('rejects a name that could smuggle path structure or is malformed', () => {
    for (const v of ['', '-lead', '.lead', '_lead', 'a/b', '..', 'a b', 'x'.repeat(129)]) expect(isName(v)).toBe(false)
  })
  it('accepts only a 32-hex id', () => {
    expect(isId(HEX32)).toBe(true)
    expect(isId('ABCDEF0123456789abcdef0123456789')).toBe(true)
    for (const v of ['', 'a'.repeat(31), 'a'.repeat(33), 'g'.repeat(32), 'example.com']) expect(isId(v)).toBe(false)
  })
})

describe('validators return an actionable message or null', () => {
  it('validates a project/script name', () => {
    expect(validateName('my-site', 'Project name')).toBeNull()
    expect(validateName('  my-site  ', 'Project name')).toBeNull()
    expect(validateName('', 'Project name')).toBe('Project name is required.')
    expect(validateName('-bad', 'Script name')).toMatch(/^Script name must start/)
  })
  it('requires a 32-hex zone id, never a domain', () => {
    expect(validateZoneId(HEX32)).toBeNull()
    expect(validateZoneId('')).toBe('Zone ID is required.')
    expect(validateZoneId('example.com')).toMatch(/32-character hex/)
  })
  it('validates a route pattern', () => {
    expect(validatePattern('example.com/*')).toBeNull()
    expect(validatePattern('')).toBe('Route pattern is required.')
    expect(validatePattern('example .com/*')).toMatch(/spaces/)
    expect(validatePattern('localhost')).toMatch(/host pattern/)
  })
  it('validates a custom domain and rejects a URL', () => {
    expect(validateDomain('app.example.com')).toBeNull()
    expect(validateDomain('app.example.com.')).toBeNull()
    expect(validateDomain('')).toBe('Domain is required.')
    expect(validateDomain('https://app.example.com')).toMatch(/bare domain/)
    expect(validateDomain('example')).toMatch(/valid domain/)
  })
  it('requires non-empty worker source', () => {
    expect(validateScript('export default {}')).toBeNull()
    expect(validateScript('   ')).toBe('Script source is required.')
  })
})

describe('workersDevUrl', () => {
  it('composes the script URL when both parts are known', () => {
    expect(workersDevUrl('api', 'acme')).toBe('https://api.acme.workers.dev')
  })
  it('is empty when the account has no subdomain, so no broken link renders', () => {
    expect(workersDevUrl('api', '')).toBe('')
    expect(workersDevUrl('', 'acme')).toBe('')
  })
})

describe('isCustomDomain', () => {
  it('separates a real custom domain from the project pages.dev host', () => {
    expect(isCustomDomain('app.example.com')).toBe(true)
    expect(isCustomDomain('my-site.pages.dev')).toBe(false)
  })
})

describe('normalizers map the REAL Cloudflare API v4 shapes', () => {
  it('normalizes a Pages project with its latest deployment', () => {
    const p = normalizeProject({
      name: 'my-site',
      subdomain: 'my-site.pages.dev',
      domains: ['my-site.pages.dev', 'app.example.com', ''],
      production_branch: 'main',
      created_on: '2026-01-02T03:04:05Z',
      latest_deployment: {
        id: 'dep1',
        url: 'https://abc.my-site.pages.dev',
        environment: 'production',
        created_on: '2026-01-02T03:04:05Z',
        latest_stage: { name: 'deploy', status: 'success' },
        deployment_trigger: { metadata: { branch: 'main' } },
      },
    })
    expect(p.name).toBe('my-site')
    expect(p.domains).toEqual(['my-site.pages.dev', 'app.example.com'])
    expect(p.productionBranch).toBe('main')
    expect(p.latestDeployment?.status).toBe('success')
    expect(p.latestDeployment?.branch).toBe('main')
  })

  it('reports no deployment rather than inventing one', () => {
    expect(normalizeProject({ name: 'fresh' }).latestDeployment).toBeNull()
    expect(normalizeDeployment(null)).toBeNull()
    expect(normalizeDeployment({})).toBeNull()
  })

  it('degrades a partial/renamed project payload instead of throwing', () => {
    const p = normalizeProject({ name: 'x' })
    expect(p).toEqual({ name: 'x', subdomain: '', domains: [], productionBranch: '', latestDeployment: null, createdAt: '' })
    expect(normalizeProject(undefined).name).toBe('')
  })

  it('unwraps a project list from a bare array or a result wrapper, dropping nameless rows', () => {
    expect(normalizeProjects([{ name: 'a' }, { name: '' }, {}]).map((p) => p.name)).toEqual(['a'])
    expect(normalizeProjects({ result: [{ name: 'b' }] }).map((p) => p.name)).toEqual(['b'])
    expect(normalizeProjects(null)).toEqual([])
  })

  it('reads a Worker script name from Cloudflare `id`', () => {
    const s = normalizeScript({ id: 'my-worker', created_on: 'c', modified_on: 'm' })
    expect(s).toEqual({ name: 'my-worker', createdAt: 'c', modifiedAt: 'm' })
    expect(normalizeScripts([{ id: 'a' }, { id: '' }]).map((x) => x.name)).toEqual(['a'])
    expect(normalizeScripts(undefined)).toEqual([])
  })

  it('normalizes a route and keeps an empty script honest (a bypass route)', () => {
    expect(normalizeRoute({ id: HEX32, pattern: 'example.com/*', script: 'w' })).toEqual({
      id: HEX32,
      pattern: 'example.com/*',
      script: 'w',
    })
    expect(normalizeRoute({ id: HEX32, pattern: 'e.com/*' }).script).toBe('')
    expect(normalizeRoutes([{ id: HEX32 }, { pattern: 'no-id' }])).toHaveLength(1)
  })

  it('reads the account workers.dev subdomain, empty when unset', () => {
    expect(normalizeSubdomain({ subdomain: 'acme' })).toBe('acme')
    expect(normalizeSubdomain({})).toBe('')
    expect(normalizeSubdomain(null)).toBe('')
  })
})
