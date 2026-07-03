import { describe, expect, it } from 'vitest'

import type { PlatformApp } from '~/lib/api/platform-apps'
import {
  appDisplayStatus,
  canDeploy,
  isDeployed,
  logSourceLabel,
  maskedEnvRows,
  SECRET_MASK,
  secretCount,
  secretSyncLabel,
  summarize,
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
