import { describe, it, expect } from 'vitest'

import {
  fmtBytes,
  fmtWhen,
  siteSlugForProject,
  domainUrl,
  latestDeployment,
  artifactContentType,
  isDeployArchive,
  checkProjectName,
} from './logic'
import type { SiteDeployment } from '~/lib/api/platform-sites'

const dep = (over: Partial<SiteDeployment>): SiteDeployment => ({
  id: 'd',
  projectId: 'p',
  version: 1,
  status: 'live',
  source: 'upload',
  files: 0,
  bytes: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

describe('formatting', () => {
  it('fmtBytes', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(1536)).toBe('1.5 KB')
    expect(fmtBytes(1048576)).toBe('1.0 MB')
  })
  it('fmtWhen honestly dashes on missing/zero', () => {
    expect(fmtWhen(undefined)).toBe('—')
    expect(fmtWhen(0)).toBe('—')
  })
})

describe('deploy helpers', () => {
  it('siteSlugForProject slugifies the IAM name (name === slug === shared key)', () => {
    expect(siteSlugForProject('My App')).toBe('my-app')
  })
  it('domainUrl builds an https URL from a bare host', () => {
    expect(domainUrl('app.example.com')).toBe('https://app.example.com/')
    expect(domainUrl('https://x.io/')).toBe('https://x.io/')
  })
  it('latestDeployment picks the highest version', () => {
    expect(latestDeployment([])).toBeNull()
    expect(latestDeployment([dep({ version: 1 }), dep({ version: 3 }), dep({ version: 2 })])?.version).toBe(3)
  })
  it('artifactContentType classifies deploy archives', () => {
    expect(artifactContentType('site.zip')).toBe('application/zip')
    expect(artifactContentType('build.tar.gz')).toBe('application/gzip')
    expect(artifactContentType('x.tgz')).toBe('application/gzip')
    expect(artifactContentType('readme.txt')).toBeNull()
    expect(isDeployArchive('a.zip')).toBe(true)
    expect(isDeployArchive('a.txt')).toBe(false)
  })
  it('checkProjectName validates + returns the slug it becomes', () => {
    expect(checkProjectName('  ').ok).toBe(false)
    expect(checkProjectName('My App')).toEqual({ ok: true, slug: 'my-app' })
    expect(checkProjectName('!!!').ok).toBe(false)
  })
})
