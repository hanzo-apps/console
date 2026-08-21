import { describe, expect, it } from 'vitest'

import { bodyField, pinnedSearch } from './iam-proxy'

describe('pinnedSearch (org-keyed lister pin — RED CRITICAL)', () => {
  // The pin is on `owner`, because `owner` is what IAM scopes a listing on.
  it('PINS an omitted owner to the caller org for a non-SuperAdmin (closes the cross-tenant enumeration)', () => {
    expect(pinnedSearch('', true, false, 'maxpower')).toBe('?owner=maxpower')
  })

  it('OVERWRITES a supplied owner for a non-SuperAdmin (server-authoritative)', () => {
    expect(pinnedSearch('?owner=hanzo', true, false, 'maxpower')).toBe('?owner=maxpower')
    expect(pinnedSearch('?owner=maxpower', true, false, 'maxpower')).toBe('?owner=maxpower')
  })

  it('leaves a SuperAdmin free to target any org (or all)', () => {
    expect(pinnedSearch('?owner=hanzo', true, true, 'admin')).toBe('?owner=hanzo')
    expect(pinnedSearch('', true, true, 'admin')).toBe('')
  })

  it('does not touch a non-org-keyed segment', () => {
    expect(pinnedSearch('?owner=maxpower', false, false, 'maxpower')).toBe('?owner=maxpower')
  })
})

// `bodyField` is the extraction the IAM proxy's tenant-scoping relies on: a
// mutation carries its target org in the BODY (owner/organization), so the proxy
// must read those and pin them (ownerAllowed) — else a brand admin could
// add-project with organization=<another tenant>. The scoping decision itself is
// `ownerAllowed` (admin-policy.test.ts); this pins the parsing it depends on.
describe('bodyField', () => {
  it('extracts the owner + organization a mutation carries', () => {
    const body = JSON.stringify({ owner: 'maxpower', organization: 'maxpower', name: 'p1' })
    expect(bodyField(body, 'owner')).toBe('maxpower')
    expect(bodyField(body, 'organization')).toBe('maxpower')
  })

  it('surfaces a CROSS-TENANT organization so the scope check can refuse it', () => {
    const body = JSON.stringify({ owner: 'maxpower', organization: 'hanzo' })
    // organization != the caller's org → ownerOk() pins it → forwardIam 403s.
    expect(bodyField(body, 'organization')).toBe('hanzo')
  })

  it('is null for a missing field, a non-string value, an empty body, or garbage', () => {
    expect(bodyField(JSON.stringify({ name: 'x' }), 'owner')).toBeNull()
    expect(bodyField(JSON.stringify({ owner: 42 }), 'owner')).toBeNull()
    expect(bodyField('', 'owner')).toBeNull()
    expect(bodyField('not json', 'organization')).toBeNull()
  })

  // An org-metadata WRITE (update-organization) carries the target org in the record's
  // `name` field (owner is the `admin` metadata org). forwardIam pins that name via
  // orgNameAllowed so a brand admin can't retarget/rename another tenant — this pins
  // the parsing that guard depends on.
  it('extracts the org NAME an update-organization write carries', () => {
    const own = JSON.stringify({ owner: 'admin', name: 'maxpower', displayName: 'Max Power' })
    const foreign = JSON.stringify({ owner: 'admin', name: 'hanzo' })
    expect(bodyField(own, 'name')).toBe('maxpower')
    // A foreign name is surfaced so orgNameAllowed() refuses it (→ forwardIam 403s).
    expect(bodyField(foreign, 'name')).toBe('hanzo')
  })
})
