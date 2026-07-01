import { describe, expect, it } from 'vitest'

import { bodyField } from './iam-proxy'

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
})
