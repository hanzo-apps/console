import { describe, expect, it } from 'vitest'

import type { PlatformApp } from '~/lib/api/platform-apps'
import {
  appDisplayStatus,
  appImageRef,
  canDeploy,
  draftsToEnv,
  envKeyValid,
  isDeployed,
  logSourceLabel,
  maskedEnvRows,
  SECRET_MASK,
  secretCount,
  secretSyncLabel,
  summarize,
  toEnvDrafts,
  validateEnvDrafts,
  type EnvDraft,
} from './logic'

describe('appDisplayStatus', () => {
  it('prefers the live health verdict, then phase, then status', () => {
    expect(appDisplayStatus({ status: 'live', phase: 'Running', health: 'green' })).toBe('green')
    expect(appDisplayStatus({ status: 'live', phase: 'Running', health: '' })).toBe('running')
    expect(appDisplayStatus({ status: 'draft', phase: '', health: '' })).toBe('draft')
    expect(appDisplayStatus({ status: '', phase: '', health: '' })).toBe('unknown')
  })
})

describe('secretSyncLabel', () => {
  it('maps sync state to an honest label, empty when no secrets', () => {
    expect(secretSyncLabel({ secretSync: 'ready' })).toBe('Secrets ready')
    expect(secretSyncLabel({ secretSync: 'pending' })).toBe('Secrets pending')
    expect(secretSyncLabel({ secretSync: 'failed' })).toBe('Secrets failed')
    expect(secretSyncLabel({ secretSync: '' })).toBe('')
    expect(secretSyncLabel({ secretSync: undefined })).toBe('')
  })
})

describe('maskedEnvRows', () => {
  it('ALWAYS masks a secret value and never leaks the plaintext', () => {
    const rows = maskedEnvRows([
      { key: 'PUBLIC', value: 'ok', secret: false },
      { key: 'DB_PASSWORD', value: 'hunter2', secret: true },
    ])
    // Sorted by key: DB_PASSWORD before PUBLIC.
    expect(rows[0]).toEqual({ key: 'DB_PASSWORD', value: SECRET_MASK, secret: true })
    expect(rows[1]).toEqual({ key: 'PUBLIC', value: 'ok', secret: false })
    // The plaintext must appear nowhere.
    expect(JSON.stringify(rows)).not.toContain('hunter2')
  })

  it('tolerates undefined/empty env', () => {
    expect(maskedEnvRows(undefined)).toEqual([])
    expect(maskedEnvRows([])).toEqual([])
  })
})

describe('secretCount', () => {
  it('counts only secret vars', () => {
    expect(secretCount([{ key: 'A', value: '', secret: true }, { key: 'B', value: 'x', secret: false }])).toBe(1)
    expect(secretCount(undefined)).toBe(0)
  })
})

describe('isDeployed / canDeploy', () => {
  it('isDeployed is false for draft/empty, true otherwise', () => {
    expect(isDeployed({ status: 'draft' })).toBe(false)
    expect(isDeployed({ status: '' })).toBe(false)
    expect(isDeployed({ status: 'live' })).toBe(true)
    expect(isDeployed({ status: 'stopped' })).toBe(true)
  })
  it('canDeploy is false while a build/deploy is in flight', () => {
    expect(canDeploy({ status: 'building' })).toBe(false)
    expect(canDeploy({ status: 'deploying' })).toBe(false)
    expect(canDeploy({ status: 'live' })).toBe(true)
    expect(canDeploy({ status: 'draft' })).toBe(true)
  })
})

describe('summarize', () => {
  it('counts live/building/failed honestly', () => {
    const apps: Pick<PlatformApp, 'status' | 'health'>[] = [
      { status: 'live', health: 'green' },
      { status: 'stopped', health: '' },
      { status: 'building', health: '' },
      { status: 'error', health: 'red' },
      { status: 'live', health: 'red' }, // red health → failed, not live
    ]
    expect(summarize(apps)).toEqual({ total: 5, live: 2, building: 1, failed: 2 })
  })
})

describe('logSourceLabel', () => {
  it('labels the source-tagged log pane', () => {
    expect(logSourceLabel('build')).toBe('Build logs')
    expect(logSourceLabel('app')).toBe('App logs')
    expect(logSourceLabel('none')).toBe('No live logs yet')
    expect(logSourceLabel(undefined)).toBe('No live logs yet')
  })
})

describe('appImageRef', () => {
  it('is repository:tag, defaulting an empty tag to latest', () => {
    expect(appImageRef({ image: { repository: 'ghcr.io/hanzoai/foo', tag: 'v1.2.3' } })).toBe('ghcr.io/hanzoai/foo:v1.2.3')
    expect(appImageRef({ image: { repository: 'ghcr.io/hanzoai/foo', tag: '' } })).toBe('ghcr.io/hanzoai/foo:latest')
    expect(appImageRef({ image: { repository: 'ghcr.io/hanzoai/foo' } })).toBe('ghcr.io/hanzoai/foo:latest')
  })
  it('is empty when the app has no image yet', () => {
    expect(appImageRef({ image: {} })).toBe('')
    expect(appImageRef({ image: { repository: '', tag: 'v1' } })).toBe('')
  })
})

describe('envKeyValid', () => {
  it('mirrors the backend env-key rule (^[A-Za-z_][A-Za-z0-9_]*$)', () => {
    expect(envKeyValid('DATABASE_URL')).toBe(true)
    expect(envKeyValid('_x')).toBe(true)
    expect(envKeyValid('A1')).toBe(true)
    expect(envKeyValid('1A')).toBe(false)
    expect(envKeyValid('has-dash')).toBe(false)
    expect(envKeyValid('has space')).toBe(false)
    expect(envKeyValid('')).toBe(false)
  })
})

describe('toEnvDrafts', () => {
  it('sorts by key and first-classes a secret as write-only (sealed, empty value)', () => {
    const drafts = toEnvDrafts([
      { key: 'PLAIN', value: 'ok', secret: false },
      { key: 'API_KEY', value: '', secret: true },
    ])
    expect(drafts.map((d) => d.key)).toEqual(['API_KEY', 'PLAIN'])
    expect(drafts[0]).toMatchObject({ key: 'API_KEY', value: '', secret: true, sealed: true, replace: false })
    expect(drafts[1]).toMatchObject({ key: 'PLAIN', value: 'ok', secret: false, sealed: false })
  })
})

describe('draftsToEnv', () => {
  const base: EnvDraft = { id: 'x', key: 'K', value: '', secret: false, sealed: false, replace: false }
  it('sends a kept sealed secret with an EMPTY value (preserve-on-empty, never a wipe)', () => {
    const out = draftsToEnv([{ ...base, key: 'API_KEY', secret: true, sealed: true, replace: false }])
    expect(out).toEqual([{ key: 'API_KEY', value: '', secret: true }])
  })
  it('sends a replaced sealed secret with its NEW typed value', () => {
    const out = draftsToEnv([{ ...base, key: 'API_KEY', value: 'new', secret: true, sealed: true, replace: true }])
    expect(out).toEqual([{ key: 'API_KEY', value: 'new', secret: true }])
  })
  it('sends a new secret and a plain var with their values, trims keys, drops empty keys', () => {
    const out = draftsToEnv([
      { ...base, key: '  TOKEN ', value: 's3cret', secret: true, sealed: false },
      { ...base, key: 'HOST', value: 'db' },
      { ...base, key: '   ', value: 'dropped' },
    ])
    expect(out).toEqual([
      { key: 'TOKEN', value: 's3cret', secret: true },
      { key: 'HOST', value: 'db', secret: false },
    ])
  })
})

describe('validateEnvDrafts', () => {
  const d = (over: Partial<EnvDraft>): EnvDraft => ({ id: 'x', key: 'K', value: 'v', secret: false, sealed: false, replace: false, ...over })
  it('accepts a valid set (incl. a kept sealed secret with no value)', () => {
    expect(validateEnvDrafts([d({ key: 'HOST', value: 'db' }), d({ key: 'API_KEY', value: '', secret: true, sealed: true })])).toBeNull()
  })
  it('rejects a missing/invalid key, a duplicate, and a valueless NEW secret', () => {
    expect(validateEnvDrafts([d({ key: '' })])).toMatch(/needs a name/)
    expect(validateEnvDrafts([d({ key: '1BAD' })])).toMatch(/not a valid name/)
    expect(validateEnvDrafts([d({ key: 'A' }), d({ key: 'A' })])).toMatch(/Duplicate/)
    expect(validateEnvDrafts([d({ key: 'TOKEN', value: '', secret: true, sealed: false })])).toMatch(/Enter a value/)
    expect(validateEnvDrafts([d({ key: 'TOKEN', value: '', secret: true, sealed: true, replace: true })])).toMatch(/Enter a value/)
  })
})
