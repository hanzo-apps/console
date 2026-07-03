import { describe, expect, it } from 'vitest'

import { ApiError } from '~/lib/api/client'
import type { PaasDeployment, PaasDomain } from '~/lib/api/paas'
import {
  appUrl,
  appSource,
  isBuildDeployment,
  orderDeployments,
  buildStatusOf,
  deploymentLabel,
  classifyPaasError,
  isPendingCustom,
  canRemoveDomain,
  domainStatusLabel,
  orderDomains,
} from './logic'

describe('appUrl', () => {
  it('makes the first domain absolute; null when none', () => {
    expect(appUrl({ domains: ['app.maxpower.hanzo.app'] })).toBe('https://app.maxpower.hanzo.app')
    expect(appUrl({ domains: ['https://x.hanzo.app'] })).toBe('https://x.hanzo.app')
    expect(appUrl({ domains: [] })).toBeNull()
    expect(appUrl({})).toBeNull()
  })
})

describe('appSource', () => {
  it('describes a git app by repo + branch', () => {
    expect(appSource({ source: 'git', repo: { url: 'https://github.com/maxpower/site.git', branch: 'main' } })).toBe('maxpower/site @ main')
  })
  it('describes an image app by ref', () => {
    expect(appSource({ source: 'image', image: { repository: 'ghcr.io/x/y', tag: 'v1' } })).toBe('ghcr.io/x/y:v1')
  })
})

describe('deployments — builds derive from git-source', () => {
  const dep = (over: Partial<PaasDeployment>): PaasDeployment => ({ id: 'd', org: 'o', applicationId: 'a', ...over })

  it('flags a git/buildId deployment as a build', () => {
    expect(isBuildDeployment(dep({ source: 'git' }))).toBe(true)
    expect(isBuildDeployment(dep({ buildId: 'b1' }))).toBe(true)
    expect(isBuildDeployment(dep({ source: 'image' }))).toBe(false)
  })
  it('orders newest version first', () => {
    const out = orderDeployments([dep({ version: 1 }), dep({ version: 3 }), dep({ version: 2 })])
    expect(out.map((d) => d.version)).toEqual([3, 2, 1])
  })
  it('derives a build status only for builds', () => {
    expect(buildStatusOf(dep({ source: 'git', status: 'live' }))).toBe('succeeded')
    expect(buildStatusOf(dep({ source: 'git', status: 'error' }))).toBe('failed')
    expect(buildStatusOf(dep({ source: 'git', status: 'building' }))).toBe('building')
    expect(buildStatusOf(dep({ source: 'image', status: 'live' }))).toBeNull()
  })
  it('labels a deployment by version or short id', () => {
    expect(deploymentLabel(dep({ version: 5 }))).toBe('v5')
    expect(deploymentLabel(dep({ id: 'abcdef123456' }))).toBe('abcdef12')
  })
})

describe('domains', () => {
  const dom = (over: Partial<PaasDomain>): PaasDomain => ({ host: 'h', kind: 'custom', status: 'pending', url: 'https://h', verified: false, ...over })

  it('flags a pending custom domain (needs DNS verification)', () => {
    expect(isPendingCustom(dom({ kind: 'custom', verified: false }))).toBe(true)
    expect(isPendingCustom(dom({ kind: 'custom', verified: true }))).toBe(false)
    expect(isPendingCustom(dom({ kind: 'subtree', verified: false }))).toBe(false)
  })

  it('never allows removing the default host', () => {
    expect(canRemoveDomain(dom({ kind: 'default', primary: true }))).toBe(false)
    expect(canRemoveDomain(dom({ kind: 'subtree' }))).toBe(true)
    expect(canRemoveDomain(dom({ kind: 'custom' }))).toBe(true)
  })

  it('renders an honest status label', () => {
    expect(domainStatusLabel(dom({ status: 'live' }))).toBe('live')
    expect(domainStatusLabel(dom({ status: 'provisioning' }))).toBe('provisioning')
    expect(domainStatusLabel(dom({ status: 'pending_deploy' }))).toBe('awaiting deploy')
    expect(domainStatusLabel(dom({ status: 'pending', kind: 'custom' }))).toBe('unverified')
    expect(domainStatusLabel(dom({ status: 'pending', kind: 'subtree' }))).toBe('pending')
  })

  it('orders default first, then subtree, then custom, each alphabetical', () => {
    const out = orderDomains([
      dom({ host: 'z.custom.com', kind: 'custom' }),
      dom({ host: 'api.maxpower.hanzo.app', kind: 'subtree' }),
      dom({ host: 'default.maxpower.hanzo.app', kind: 'default', primary: true }),
      dom({ host: 'a.custom.com', kind: 'custom' }),
    ])
    expect(out.map((d) => d.host)).toEqual([
      'default.maxpower.hanzo.app',
      'api.maxpower.hanzo.app',
      'a.custom.com',
      'z.custom.com',
    ])
  })
})

describe('classifyPaasError — a signed-in user is never told to sign in', () => {
  it('maps status codes honestly', () => {
    expect(classifyPaasError(new ApiError('x', 401)).kind).toBe('signin')
    expect(classifyPaasError(new ApiError('x', 403)).kind).toBe('forbidden')
    expect(classifyPaasError(new ApiError('x', 404)).kind).toBe('unavailable')
    expect(classifyPaasError(new ApiError('x', 500)).kind).toBe('error')
  })
})
