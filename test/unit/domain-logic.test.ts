import { describe, it, expect } from 'vitest'

import { newModelRoute } from '~/components/products/models/logic'
import { newApplication, isUndeployed, STATUS_OPTIONS } from '~/components/products/applications/logic'
import { newStore } from '~/components/products/stores/logic'

/** New-record templates + lifecycle predicates ported from casibase. */
describe('newModelRoute', () => {
  it('starts with an empty modelName (filled in the create form) and enabled=true', () => {
    const r = newModelRoute('hanzo')
    expect(r.owner).toBe('hanzo')
    expect(r.modelName).toBe('')
    expect(r.enabled).toBe(true)
    expect(r.premium).toBe(false)
    expect(r.name).toMatch(/^route_/)
  })
})

describe('newApplication', () => {
  it('is an undeployed app in its own namespace', () => {
    const a = newApplication('hanzo')
    expect(a.owner).toBe('hanzo')
    expect(a.status).toBe('Not Deployed')
    expect(a.namespace).toMatch(/^hanzo-cloud-app-/)
    expect(a.name).toMatch(/^application_/)
  })
})

describe('isUndeployed', () => {
  it('is true when status is missing or "Not Deployed"', () => {
    expect(isUndeployed({ owner: 'o', name: 'a' })).toBe(true)
    expect(isUndeployed({ owner: 'o', name: 'a', status: 'Not Deployed' })).toBe(true)
  })

  it('is false once the app is Pending/Running/Failed', () => {
    expect(isUndeployed({ owner: 'o', name: 'a', status: 'Running' })).toBe(false)
    expect(isUndeployed({ owner: 'o', name: 'a', status: 'Pending' })).toBe(false)
  })

  it('STATUS_OPTIONS covers the lifecycle', () => {
    expect(STATUS_OPTIONS).toEqual(['Not Deployed', 'Pending', 'Running', 'Failed'])
  })
})

describe('newStore', () => {
  it('wires the built-in storage provider and browser speech defaults', () => {
    const s = newStore('hanzo')
    expect(s.owner).toBe('hanzo')
    expect(s.storageProvider).toBe('provider-storage-built-in')
    expect(s.textToSpeechProvider).toBe('Browser Built-In')
    expect(s.state).toBe('Active')
    expect(s.name).toMatch(/^store_/)
  })
})
