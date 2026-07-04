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
  targetIsGit,
  buildTypeFor,
  looksLikeGitUrl,
  looksLikeImageRef,
  parseImageRef,
  deriveAppName,
  createAppInputFor,
  deployInputFor,
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

// ── Deploy targets (the "Deploy something new" composer) ─────────────────────

describe('targetIsGit / buildTypeFor', () => {
  it('service + static are git; container is image', () => {
    expect(targetIsGit('service')).toBe(true)
    expect(targetIsGit('static')).toBe(true)
    expect(targetIsGit('container')).toBe(false)
  })
  it('maps each target to the platform buildType (closed set)', () => {
    expect(buildTypeFor('service')).toBe('nixpacks')
    expect(buildTypeFor('static')).toBe('static')
    expect(buildTypeFor('container')).toBe('image')
  })
})

describe('looksLikeGitUrl', () => {
  it('accepts https repos on the allowed hosts and any .git URL', () => {
    expect(looksLikeGitUrl('https://github.com/hanzoai/console')).toBe(true)
    expect(looksLikeGitUrl('https://github.com/hanzoai/console.git')).toBe(true)
    expect(looksLikeGitUrl('https://gitlab.com/group/proj')).toBe(true)
    expect(looksLikeGitUrl('https://bitbucket.org/team/repo')).toBe(true)
    expect(looksLikeGitUrl('https://git.example.com/x/y.git')).toBe(true)
    expect(looksLikeGitUrl('git@github.com:hanzoai/console.git')).toBe(true)
  })
  it('rejects a description, an image ref, or an empty string', () => {
    expect(looksLikeGitUrl('')).toBe(false)
    expect(looksLikeGitUrl('a todo app with auth')).toBe(false)
    expect(looksLikeGitUrl('ghcr.io/hanzoai/app:1.2.3')).toBe(false)
    expect(looksLikeGitUrl('https://example.com/not/a/known/host')).toBe(false)
  })
})

describe('looksLikeImageRef', () => {
  it('accepts registry paths and bare names, with optional tag/digest', () => {
    expect(looksLikeImageRef('ghcr.io/hanzoai/app:1.2.3')).toBe(true)
    expect(looksLikeImageRef('ghcr.io/hanzoai/app')).toBe(true)
    expect(looksLikeImageRef('nginx')).toBe(true)
    expect(looksLikeImageRef('localhost:5000/app:v1')).toBe(true)
    expect(looksLikeImageRef('nginx@sha256:abc123')).toBe(true)
  })
  it('rejects a URL, whitespace, or empty', () => {
    expect(looksLikeImageRef('')).toBe(false)
    expect(looksLikeImageRef('https://github.com/org/repo')).toBe(false)
    expect(looksLikeImageRef('two words')).toBe(false)
  })
})

describe('parseImageRef', () => {
  it('splits repository + tag, defaulting to latest', () => {
    expect(parseImageRef('ghcr.io/hanzoai/app:1.2.3')).toEqual({ repository: 'ghcr.io/hanzoai/app', tag: '1.2.3' })
    expect(parseImageRef('ghcr.io/hanzoai/app')).toEqual({ repository: 'ghcr.io/hanzoai/app', tag: 'latest' })
    expect(parseImageRef('nginx')).toEqual({ repository: 'nginx', tag: 'latest' })
  })
  it('does not mistake a registry host:port for a tag', () => {
    expect(parseImageRef('localhost:5000/app:v1')).toEqual({ repository: 'localhost:5000/app', tag: 'v1' })
    expect(parseImageRef('localhost:5000/app')).toEqual({ repository: 'localhost:5000/app', tag: 'latest' })
  })
})

describe('deriveAppName', () => {
  it('derives a k8s-safe name from a repo URL', () => {
    expect(deriveAppName('https://github.com/hanzoai/My-Console.git')).toBe('my-console')
    expect(deriveAppName('git@github.com:hanzoai/console.git')).toBe('console')
    expect(deriveAppName('https://gitlab.com/group/sub/Cool_App')).toBe('cool-app')
  })
  it('derives from an image ref (dropping the tag/digest)', () => {
    expect(deriveAppName('ghcr.io/hanzoai/app:1.2.3')).toBe('app')
    expect(deriveAppName('nginx@sha256:abc')).toBe('nginx')
  })
  it('returns empty for empty/all-symbol input', () => {
    expect(deriveAppName('')).toBe('')
    expect(deriveAppName('   ')).toBe('')
  })
})

describe('createAppInputFor', () => {
  it('service → git source, nixpacks build, repo+branch', () => {
    expect(createAppInputFor('service', { name: 'web', ref: 'https://github.com/o/r', branch: 'dev' })).toEqual({
      name: 'web',
      source: 'git',
      repo: { url: 'https://github.com/o/r', branch: 'dev' },
      buildType: 'nixpacks',
    })
  })
  it('static → git source, static build, branch defaults to main', () => {
    expect(createAppInputFor('static', { name: 'site', ref: 'https://github.com/o/r' })).toEqual({
      name: 'site',
      source: 'git',
      repo: { url: 'https://github.com/o/r', branch: 'main' },
      buildType: 'static',
    })
  })
  it('container → image source, image build, parsed repository+tag', () => {
    expect(createAppInputFor('container', { name: 'api', ref: 'ghcr.io/o/app:1.0' })).toEqual({
      name: 'api',
      source: 'image',
      image: { repository: 'ghcr.io/o/app', tag: '1.0' },
      buildType: 'image',
    })
  })
})

describe('deployInputFor', () => {
  it('pins the tag for a container, empty body for git', () => {
    expect(deployInputFor('container', 'ghcr.io/o/app:2.0')).toEqual({ tag: '2.0' })
    expect(deployInputFor('service', 'https://github.com/o/r')).toEqual({})
    expect(deployInputFor('static', 'https://github.com/o/r')).toEqual({})
  })
})
