import { describe, it, expect } from 'vitest'

import {
  normalizeOrgSettings,
  settingsFrom,
  routingState,
  planSave,
  planRevert,
  emptyOrgSettings,
  GLOBAL_DEFAULT_OWNER,
} from './org-settings'

/**
 * Org-settings admin client — the pure state mapping + read-modify-write planning.
 * These are the load-bearing decisions (three-state ↔ the stored string; a write
 * that never clobbers sibling routing-policy fields; revert = delete only when the
 * row holds nothing else), so they are unit-tested with NO network.
 */

describe('normalizeOrgSettings', () => {
  it('reads a full row and keeps the raw for write-back', () => {
    const raw = {
      owner: 'hanzo',
      autoRouting: 'enabled',
      defaultSessionRouting: 'disabled',
      routerCostCeiling: 0.5,
      updatedTime: '2026-07-16T00:00:00Z',
    }
    const s = normalizeOrgSettings(raw)
    expect(s.owner).toBe('hanzo')
    expect(s.autoRouting).toBe('enabled')
    expect(s.updatedTime).toBe('2026-07-16T00:00:00Z')
    expect(s.raw).toEqual(raw)
  })

  it('is honest-empty on junk and coerces an unknown autoRouting to "" (unset)', () => {
    expect(normalizeOrgSettings(null)).toEqual({ owner: '', autoRouting: '', updatedTime: '', raw: {} })
    expect(normalizeOrgSettings({ owner: 'acme', autoRouting: 'maybe' }).autoRouting).toBe('')
    expect(normalizeOrgSettings({ owner: 'acme', autoRouting: true }).autoRouting).toBe('')
  })
})

describe('settingsFrom', () => {
  it('reads an array and drops rows with no owner', () => {
    const out = settingsFrom([{ owner: 'a', autoRouting: 'enabled' }, { owner: '' }, { autoRouting: 'disabled' }])
    expect(out.map((s) => s.owner)).toEqual(['a'])
  })

  it('is honest-empty on a non-array payload', () => {
    expect(settingsFrom(null)).toEqual([])
    expect(settingsFrom({})).toEqual([])
    expect(settingsFrom('nope')).toEqual([])
  })
})

describe('routingState', () => {
  it('maps the stored string (and a missing row) to the three-state control', () => {
    expect(routingState(null)).toBe('inherit')
    expect(routingState(emptyOrgSettings('acme'))).toBe('inherit')
    expect(routingState(normalizeOrgSettings({ owner: 'a', autoRouting: '' }))).toBe('inherit')
    expect(routingState(normalizeOrgSettings({ owner: 'a', autoRouting: 'enabled' }))).toBe('enabled')
    expect(routingState(normalizeOrgSettings({ owner: 'a', autoRouting: 'disabled' }))).toBe('disabled')
  })
})

describe('planSave', () => {
  it('sets autoRouting + pins owner on a fresh (no-row) org', () => {
    expect(planSave(null, 'hanzo', 'enabled')).toEqual({ owner: 'hanzo', autoRouting: 'enabled' })
  })

  it('the "org hanzo → enabled" activation writes the hanzo row', () => {
    const row = planSave(emptyOrgSettings('hanzo'), 'hanzo', 'enabled')
    expect(row.owner).toBe('hanzo')
    expect(row.autoRouting).toBe('enabled')
  })

  it('preserves sibling routing-policy fields (never clobbers a full-row replace)', () => {
    const current = normalizeOrgSettings({
      owner: 'acme',
      autoRouting: '',
      routerPrefer: { default: ['zen-1', 'zen-2'] },
      routerCostCeiling: 0.8,
      defaultSessionRouting: 'enabled',
      trainingContribution: 'enabled',
      createdTime: '2026-01-01T00:00:00Z',
    })
    const row = planSave(current, 'acme', 'disabled')
    expect(row.autoRouting).toBe('disabled')
    expect(row.routerPrefer).toEqual({ default: ['zen-1', 'zen-2'] })
    expect(row.routerCostCeiling).toBe(0.8)
    expect(row.defaultSessionRouting).toBe('enabled')
    expect(row.trainingContribution).toBe('enabled')
    expect(row.createdTime).toBe('2026-01-01T00:00:00Z')
  })

  it('sets the global default on the reserved "*" row', () => {
    expect(planSave(null, GLOBAL_DEFAULT_OWNER, 'enabled')).toEqual({ owner: '*', autoRouting: 'enabled' })
  })
})

describe('planRevert', () => {
  it('is a no-op when the org has no row (already inherit)', () => {
    expect(planRevert(null)).toEqual({ op: 'noop' })
  })

  it('DELETES the row when it only carried auto-routing (revert = delete)', () => {
    const current = normalizeOrgSettings({ owner: 'hanzo', autoRouting: 'enabled' })
    expect(planRevert(current)).toEqual({ op: 'delete', owner: 'hanzo' })
  })

  it('keeps the row and clears only autoRouting when router policy is set (no clobber)', () => {
    const current = normalizeOrgSettings({
      owner: 'acme',
      autoRouting: 'enabled',
      routerPrefer: { default: ['zen-1'] },
      routerCostCeiling: 0.5,
    })
    const plan = planRevert(current)
    expect(plan.op).toBe('update')
    if (plan.op === 'update') {
      expect(plan.row.autoRouting).toBe('')
      expect(plan.row.routerPrefer).toEqual({ default: ['zen-1'] })
      expect(plan.row.routerCostCeiling).toBe(0.5)
      expect(plan.row.owner).toBe('acme')
    }
  })

  it('keeps the row when a sibling three-state (defaultSessionRouting) is set', () => {
    const current = normalizeOrgSettings({ owner: 'acme', autoRouting: 'disabled', defaultSessionRouting: 'enabled' })
    const plan = planRevert(current)
    expect(plan.op).toBe('update')
    if (plan.op === 'update') expect(plan.row.autoRouting).toBe('')
  })
})
