import { describe, expect, it } from 'vitest'

import { normalizeCatalog, normalizeFlow, normalizeFlows, normalizePiece, normalizeRun, normalizeRuns } from './automations'

describe('normalizeFlow', () => {
  it('reads a populated flow (displayName from the version)', () => {
    const f = normalizeFlow({
      id: 'flow_1',
      projectId: 'acme',
      externalId: 'crm-sync',
      status: 'ENABLED',
      publishedVersionId: 'ver_9',
      created: 1,
      updated: 2,
      version: { id: 'ver_9', displayName: 'CRM Sync', valid: true, state: 'DRAFT' },
    })
    expect(f).toMatchObject({
      id: 'flow_1',
      externalId: 'crm-sync',
      status: 'ENABLED',
      publishedVersionId: 'ver_9',
      displayName: 'CRM Sync',
      created: 1,
      updated: 2,
    })
  })
  it('a bare list row has no displayName and defaults status to DISABLED', () => {
    const f = normalizeFlow({ id: 'flow_2' })
    expect(f.displayName).toBeUndefined()
    expect(f.status).toBe('DISABLED')
  })
  it('coerces garbage to honest defaults (never throws)', () => {
    expect(() => normalizeFlow(null)).not.toThrow()
    const f = normalizeFlow({ id: 5, status: 'BOGUS', created: 'x' })
    expect(f).toMatchObject({ id: '', status: 'DISABLED', created: 0 })
  })
})

describe('normalizeFlows', () => {
  it('unwraps {data:[…]} and drops id-less rows', () => {
    const rows = normalizeFlows({ data: [{ id: 'a' }, { id: '' }, { id: 'b' }] })
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
  it('accepts a bare array and tolerates garbage', () => {
    expect(normalizeFlows([{ id: 'a' }])).toHaveLength(1)
    expect(normalizeFlows(null)).toEqual([])
    expect(normalizeFlows({ nope: 1 })).toEqual([])
  })
})

describe('normalizeRun / normalizeRuns', () => {
  it('normalizes a run and defaults an unknown status to RUNNING', () => {
    expect(normalizeRun({ id: 'run_1', flowId: 'f', status: 'SUCCEEDED', startTime: 10 })).toMatchObject({
      id: 'run_1',
      flowId: 'f',
      status: 'SUCCEEDED',
      startTime: 10,
    })
    expect(normalizeRun({ id: 'r', status: 'weird' }).status).toBe('RUNNING')
  })
  it('unwraps and filters the runs list', () => {
    expect(normalizeRuns({ data: [{ id: 'r1' }, { id: '' }] }).map((r) => r.id)).toEqual(['r1'])
    expect(normalizeRuns(null)).toEqual([])
  })
})

describe('normalizePiece / normalizeCatalog', () => {
  it('normalizes a piece with actions, triggers, categories, and auth', () => {
    const p = normalizePiece({
      name: 'slack',
      displayName: 'Slack',
      description: 'chat',
      logoUrl: 'https://x/slack.png',
      version: '1.2.3',
      categories: ['COMMUNICATION', 5, ''],
      auth: { type: 'oauth2', required: true },
      actions: [{ name: 'send', displayName: 'Send message' }],
      triggers: [{ name: 'new_msg' }],
    })
    expect(p.categories).toEqual(['COMMUNICATION'])
    expect(p.actions).toEqual([{ name: 'send', displayName: 'Send message', description: '' }])
    expect(p.triggers[0].displayName).toBe('new_msg') // falls back to name
    expect(p.auth).toEqual({ type: 'oauth2', required: true })
  })
  it('derives pieceCount from the array when the field is absent, drops nameless pieces', () => {
    const c = normalizeCatalog({ pieces: [{ name: 'a' }, { name: '' }, { name: 'b' }] })
    expect(c.pieces.map((p) => p.name)).toEqual(['a', 'b'])
    expect(c.pieceCount).toBe(2)
  })
  it('trusts a declared pieceCount and tolerates garbage', () => {
    expect(normalizeCatalog({ pieceCount: 706, pieces: [] }).pieceCount).toBe(706)
    expect(normalizeCatalog(null)).toEqual({ pieceCount: 0, pieces: [] })
  })
})
