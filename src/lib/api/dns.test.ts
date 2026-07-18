import { describe, it, expect } from 'vitest'

import {
  RECORD_TYPES,
  hasPriority,
  isProxyable,
  isCloudflare,
  providerLabel,
  displayZone,
  validateZoneName,
  validateRecord,
  createBody,
  patchBody,
  normalizeZone,
  normalizeZones,
  normalizeRecord,
  normalizeRecords,
  type DnsRecord,
  type RecordInput,
} from './dns'

const rec = (over: Partial<RecordInput> = {}): RecordInput => ({
  name: 'www',
  type: 'A',
  content: '1.2.3.4',
  ttl: 300,
  priority: 0,
  proxied: false,
  ...over,
})

describe('record-type predicates', () => {
  it('marks only MX/SRV as priority-bearing', () => {
    expect(hasPriority('MX')).toBe(true)
    expect(hasPriority('SRV')).toBe(true)
    for (const t of ['A', 'AAAA', 'CNAME', 'TXT', 'NS', 'SOA', 'CAA']) expect(hasPriority(t)).toBe(false)
  })
  it('marks only A/AAAA/CNAME as proxyable', () => {
    expect(isProxyable('A')).toBe(true)
    expect(isProxyable('AAAA')).toBe(true)
    expect(isProxyable('CNAME')).toBe(true)
    for (const t of ['MX', 'TXT', 'NS', 'SOA', 'CAA', 'SRV']) expect(isProxyable(t)).toBe(false)
  })
})

describe('provider helpers', () => {
  it('detects cloudflare case-insensitively', () => {
    expect(isCloudflare('cloudflare')).toBe(true)
    expect(isCloudflare('Cloudflare')).toBe(true)
    expect(isCloudflare('authoritative')).toBe(false)
    expect(isCloudflare('')).toBe(false)
  })
  it('labels providers honestly', () => {
    expect(providerLabel('cloudflare')).toBe('Cloudflare')
    expect(providerLabel('authoritative')).toBe('Authoritative')
    expect(providerLabel('route53')).toBe('Authoritative') // unknown → non-CF label, never fabricated
  })
})

describe('displayZone', () => {
  it('strips exactly one trailing dot', () => {
    expect(displayZone('example.com.')).toBe('example.com')
    expect(displayZone('example.com')).toBe('example.com')
    expect(displayZone('sub.example.com.')).toBe('sub.example.com')
  })
})

describe('validateZoneName', () => {
  it('accepts a bare apex domain', () => {
    expect(validateZoneName('example.com')).toBeNull()
    expect(validateZoneName('sub.example.co.uk')).toBeNull()
    expect(validateZoneName('example.com.')).toBeNull() // trailing dot tolerated
  })
  it('rejects empty / spaces / URLs / single label', () => {
    expect(validateZoneName('')).toMatch(/required/)
    expect(validateZoneName('  ')).toMatch(/required/)
    expect(validateZoneName('foo bar.com')).toMatch(/spaces/)
    expect(validateZoneName('https://example.com')).toMatch(/URL/)
    expect(validateZoneName('example.com/path')).toMatch(/URL/)
    expect(validateZoneName('localhost')).toMatch(/valid domain/)
    expect(validateZoneName('-bad.com')).toMatch(/valid domain/)
  })
})

describe('validateRecord', () => {
  it('accepts a well-formed A record', () => {
    expect(validateRecord(rec())).toBeNull()
  })
  it('requires name/content/type', () => {
    expect(validateRecord(rec({ name: '  ' }))).toMatch(/Name is required/)
    expect(validateRecord(rec({ content: '' }))).toMatch(/Content is required/)
    expect(validateRecord(rec({ type: 'BOGUS' as never }))).toMatch(/record type/)
  })
  it('rejects a negative / non-integer TTL', () => {
    expect(validateRecord(rec({ ttl: -1 }))).toMatch(/TTL/)
    expect(validateRecord(rec({ ttl: 1.5 }))).toMatch(/TTL/)
  })
  it('requires a valid priority only for MX/SRV', () => {
    expect(validateRecord(rec({ type: 'MX', content: 'mail.example.com', priority: -1 }))).toMatch(/Priority/)
    expect(validateRecord(rec({ type: 'MX', content: 'mail.example.com', priority: 10 }))).toBeNull()
    // priority ignored for a non-MX/SRV type even if odd
    expect(validateRecord(rec({ type: 'A', priority: -5 }))).toBeNull()
  })
})

describe('createBody', () => {
  it('omits priority for a non-MX/SRV type', () => {
    const b = createBody(rec({ type: 'A' }), true)
    expect(b).not.toHaveProperty('priority')
  })
  it('includes priority for MX', () => {
    const b = createBody(rec({ type: 'MX', content: 'mail.example.com', priority: 10 }), false)
    expect(b.priority).toBe(10)
  })
  it('only sends proxied on a proxyable type of a cloudflare zone', () => {
    expect(createBody(rec({ type: 'A', proxied: true }), true).proxied).toBe(true)
    // authoritative zone → never sends proxied
    expect(createBody(rec({ type: 'A', proxied: true }), false)).not.toHaveProperty('proxied')
    // cloudflare zone but non-proxyable type → never sends proxied
    expect(createBody(rec({ type: 'TXT', content: 'v=spf1', proxied: true }), true)).not.toHaveProperty('proxied')
  })
  it('trims name and content', () => {
    const b = createBody(rec({ name: '  www  ', content: '  1.2.3.4  ' }), false)
    expect(b.name).toBe('www')
    expect(b.content).toBe('1.2.3.4')
  })
})

describe('patchBody', () => {
  const before: DnsRecord = {
    id: 'r1', name: 'www', type: 'A', ttl: 300, content: '1.2.3.4', priority: 0, proxied: false, updatedAt: '',
  }
  it('is empty when nothing changed', () => {
    expect(patchBody(before, rec(), false)).toEqual({})
  })
  it('includes only changed fields', () => {
    expect(patchBody(before, rec({ content: '5.6.7.8' }), false)).toEqual({ content: '5.6.7.8' })
    expect(patchBody(before, rec({ ttl: 600 }), false)).toEqual({ ttl: 600 })
  })
  it('sends a proxied change only for a proxyable cloudflare record', () => {
    expect(patchBody(before, rec({ proxied: true }), true)).toEqual({ proxied: true })
    // same change on an authoritative zone → not sent
    expect(patchBody(before, rec({ proxied: true }), false)).toEqual({})
  })
})

describe('normalizeZone / normalizeZones', () => {
  it('maps the hanzodns zone shape (zone/record_count/dnssec_enabled)', () => {
    const z = normalizeZone({
      id: 'z1', zone: 'example.com.', status: 'active', record_count: 3,
      dnssec_enabled: true, nameservers: ['ns1.hanzo.ai.', 'ns2.hanzo.ai.'], updated_at: '2026-07-18T00:00:00Z',
    })
    expect(z.name).toBe('example.com.')
    expect(z.recordCount).toBe(3)
    expect(z.dnssec).toBe(true)
    expect(z.nameservers).toHaveLength(2)
    expect(z.provider).toBe('authoritative') // absent provider → authoritative
  })
  it('honors an explicit cloudflare provider', () => {
    expect(normalizeZone({ zone: 'cf.com.', provider: 'cloudflare' }).provider).toBe('cloudflare')
  })
  it('unwraps { zones, total } and a bare array; garbage → []', () => {
    expect(normalizeZones({ zones: [{ zone: 'a.com.' }, { zone: 'b.com.' }], total: 2 })).toHaveLength(2)
    expect(normalizeZones([{ zone: 'a.com.' }])).toHaveLength(1)
    expect(normalizeZones(null)).toEqual([])
    expect(normalizeZones({ nope: true })).toEqual([])
    // a row with no name is dropped (never a blank zone)
    expect(normalizeZones({ zones: [{ status: 'active' }] })).toEqual([])
  })
})

describe('normalizeRecord / normalizeRecords', () => {
  it('maps content (falling back to value) and uppercases the type', () => {
    const r = normalizeRecord({ id: 'r1', name: 'www', type: 'a', ttl: 300, content: '1.2.3.4', proxied: true })
    expect(r.type).toBe('A')
    expect(r.content).toBe('1.2.3.4')
    expect(r.proxied).toBe(true)
    expect(normalizeRecord({ id: 'r2', name: 'mx', type: 'MX', value: 'mail.example.com', priority: 10 }).content).toBe('mail.example.com')
  })
  it('unwraps { records, total }; drops id-less rows; garbage → []', () => {
    expect(normalizeRecords({ records: [{ id: 'r1', name: '@', type: 'A', content: '1.1.1.1' }], total: 1 })).toHaveLength(1)
    expect(normalizeRecords([{ id: 'r1', name: '@', type: 'A', content: '1.1.1.1' }])).toHaveLength(1)
    expect(normalizeRecords({ records: [{ name: 'no-id' }] })).toEqual([])
    expect(normalizeRecords(undefined)).toEqual([])
  })
})

describe('RECORD_TYPES', () => {
  it('matches the hanzodns store ValidRecordTypes set', () => {
    expect([...RECORD_TYPES].sort()).toEqual(['A', 'AAAA', 'CAA', 'CNAME', 'MX', 'NS', 'SOA', 'SRV', 'TXT'])
  })
})
