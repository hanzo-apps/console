import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  normalizePackage,
  normalizePackages,
  packageById,
  fillPattern,
  packageHost,
  packageAppId,
  SERVICE_LABELS,
  type PackageService,
} from './packages'

// The platform SEED — the console does NOT import this at runtime; the test reads it
// to prove the seed rows normalize cleanly (the platform serves them via /v1/packages).
const SEED = JSON.parse(
  readFileSync(join(process.cwd(), 'platform-seed', 'packages.json'), 'utf8'),
) as { packages: unknown[] }

describe('normalizePackage (data-driven — no hardcoded catalog)', () => {
  it('normalizes a well-formed record', () => {
    const p = normalizePackage({
      id: 'x',
      name: 'X',
      description: 'd',
      services: ['ats', 'iam'],
      brandTemplate: { customBrand: true, hostPattern: 'ats.{slug}.com' },
      iamTemplate: { ownIssuer: true, appPattern: '{slug}-ats' },
      domainPattern: 'ats.{slug}.com',
      plan: 'enterprise',
      sovereign: false,
    })!
    expect(p.id).toBe('x')
    expect(p.services).toEqual(['ats', 'iam'])
    expect(p.plan).toBe('enterprise')
  })

  it('returns null for a record with no id (unusable → filtered out)', () => {
    expect(normalizePackage({ name: 'no id' })).toBeNull()
    expect(normalizePackage(null)).toBeNull()
  })

  it('drops unknown services and falls back a bad plan (never throws/fabricates)', () => {
    const p = normalizePackage({ id: 'y', services: ['ats', 'bogus', 42], plan: 'nope' })!
    expect(p.services).toEqual(['ats'])
    expect(p.plan).toBe('pay-as-you-go')
  })

  it('derives hostPattern from domainPattern when absent, and vice-versa', () => {
    const a = normalizePackage({ id: 'a', domainPattern: 'a.{slug}.com' })!
    expect(a.brandTemplate.hostPattern).toBe('a.{slug}.com')
    const b = normalizePackage({ id: 'b', brandTemplate: { hostPattern: 'b.{slug}.com' } })!
    expect(b.domainPattern).toBe('b.{slug}.com')
  })
})

describe('normalizePackages list', () => {
  it('reads a bare array, {packages}, or {data}; honest empty for garbage', () => {
    expect(normalizePackages([{ id: 'a' }]).map((p) => p.id)).toEqual(['a'])
    expect(normalizePackages({ packages: [{ id: 'b' }] }).map((p) => p.id)).toEqual(['b'])
    expect(normalizePackages({ data: [{ id: 'c' }] }).map((p) => p.id)).toEqual(['c'])
    expect(normalizePackages(null)).toEqual([])
    expect(normalizePackages('nope')).toEqual([])
  })

  it('filters out id-less rows', () => {
    expect(normalizePackages([{ id: 'a' }, { name: 'no id' }]).map((p) => p.id)).toEqual(['a'])
  })
})

describe('platform seed rows', () => {
  const seeded = normalizePackages(SEED.packages)

  it('the seed carries the eight canonical presets, all normalizing cleanly', () => {
    expect(seeded.map((p) => p.id)).toEqual([
      'console-admin',
      'paas',
      'dex',
      'bank',
      'ats',
      'bd',
      'ta',
      'sovereign-l1',
    ])
  })

  it('sovereign-l1 bundles ats+bd+ta+chain and is flagged sovereign', () => {
    const s = packageById(seeded, 'sovereign-l1')!
    expect(s.sovereign).toBe(true)
    for (const svc of ['ats', 'bd', 'ta', 'chain'] as PackageService[]) {
      expect(s.services).toContain(svc)
    }
    expect(s.iamTemplate.ownIssuer).toBe(true)
  })

  it('every seeded service has a human label', () => {
    for (const p of seeded) for (const svc of p.services) expect(SERVICE_LABELS[svc]).toBeTruthy()
  })

  it('packageById returns undefined for an unknown id (honest, no throw)', () => {
    expect(packageById(seeded, 'nope')).toBeUndefined()
  })
})

describe('pattern substitution', () => {
  it('fills {slug} in a pattern', () => {
    expect(fillPattern('console.{slug}.hanzo.app', 'acme')).toBe('console.acme.hanzo.app')
  })

  it('leaves the literal token when slug is blank (never a broken host)', () => {
    expect(fillPattern('console.{slug}.hanzo.app', '')).toBe('console.{slug}.hanzo.app')
    expect(fillPattern('console.{slug}.hanzo.app', '   ')).toBe('console.{slug}.hanzo.app')
  })

  it('replaces every occurrence', () => {
    expect(fillPattern('{slug}-{slug}', 'x')).toBe('x-x')
  })

  it('packageHost / packageAppId fill the tenant slug', () => {
    const p = normalizePackages(SEED.packages).find((x) => x.id === 'sovereign-l1')!
    expect(packageHost(p, 'lux')).toBe('lux.network')
    expect(packageAppId(p, 'lux')).toBe('lux-console')
  })
})
