import { describe, expect, it } from 'vitest'

import type { AutomationFlow, FlowRun, Piece } from '~/lib/api/automations'
import {
  authLabel,
  capabilitySummary,
  filterPieces,
  flowName,
  flowStatusText,
  formatWhen,
  MAX_FLOW_NAME,
  pieceCategories,
  runStatusText,
  summarizeFlows,
  summarizeRuns,
  validateFlowName,
} from './logic'

const flow = (o: Partial<AutomationFlow>): AutomationFlow => ({
  id: 'flow_1',
  externalId: '',
  status: 'DISABLED',
  publishedVersionId: '',
  created: 0,
  updated: 0,
  ...o,
})

const run = (o: Partial<FlowRun>): FlowRun => ({
  id: 'run_1',
  flowId: 'flow_1',
  flowVersionId: 'ver_1',
  status: 'RUNNING',
  startTime: 0,
  finishTime: 0,
  created: 0,
  ...o,
})

const piece = (o: Partial<Piece>): Piece => ({
  name: 'slack',
  displayName: 'Slack',
  description: 'Send messages',
  logoUrl: '',
  version: '1.0.0',
  categories: ['COMMUNICATION'],
  auth: { type: 'oauth2', required: true },
  actions: [],
  triggers: [],
  ...o,
})

describe('flowName', () => {
  it('prefers displayName, then externalId, then a short id, never fabricates', () => {
    expect(flowName({ displayName: 'Onboarding', externalId: 'x', id: 'flow_abc' })).toBe('Onboarding')
    expect(flowName({ displayName: '  ', externalId: 'crm-sync', id: 'flow_abc' })).toBe('crm-sync')
    expect(flowName({ displayName: undefined, externalId: '', id: 'flow_abcdef123' })).toBe('Flow flow_abc')
    expect(flowName({ displayName: '', externalId: '', id: '' })).toBe('Untitled flow')
  })
})

describe('status text (StatusTag tone input)', () => {
  it('lowercases flow + run statuses for the shared StatusTag', () => {
    expect(flowStatusText('ENABLED')).toBe('enabled')
    expect(flowStatusText('DISABLED')).toBe('disabled')
    expect(flowStatusText('')).toBe('disabled')
    expect(runStatusText('SUCCEEDED')).toBe('succeeded')
    expect(runStatusText('')).toBe('running')
  })
})

describe('summarizeFlows', () => {
  it('counts enabled vs disabled', () => {
    expect(summarizeFlows([flow({ status: 'ENABLED' }), flow({ status: 'DISABLED' }), flow({ status: 'ENABLED' })])).toEqual(
      { total: 3, enabled: 2, disabled: 1 },
    )
    expect(summarizeFlows([])).toEqual({ total: 0, enabled: 0, disabled: 0 })
  })
})

describe('summarizeRuns', () => {
  it('buckets in-flight, succeeded, and every terminal-failure state', () => {
    const runs = [
      run({ status: 'RUNNING' }),
      run({ status: 'QUEUED' }),
      run({ status: 'PAUSED' }),
      run({ status: 'SUCCEEDED' }),
      run({ status: 'FAILED' }),
      run({ status: 'CANCELED' }),
      run({ status: 'TIMEOUT' }),
    ]
    expect(summarizeRuns(runs)).toEqual({ total: 7, running: 3, succeeded: 1, failed: 3 })
  })
})

describe('pieceCategories', () => {
  it('returns a sorted, de-duplicated, trimmed set (drops empties)', () => {
    const pieces = [
      piece({ categories: ['COMMUNICATION', 'PRODUCTIVITY'] }),
      piece({ categories: ['COMMUNICATION ', ' AI'] }), // trimmed → dedups COMMUNICATION
      piece({ categories: [''] }), // dropped
    ]
    expect(pieceCategories(pieces)).toEqual(['AI', 'COMMUNICATION', 'PRODUCTIVITY'])
  })
})

describe('filterPieces', () => {
  const pieces = [
    piece({ name: 'slack', displayName: 'Slack', description: 'Team chat', categories: ['COMMUNICATION'] }),
    piece({ name: 'gmail', displayName: 'Gmail', description: 'Send email', categories: ['COMMUNICATION'] }),
    piece({ name: 'sheets', displayName: 'Google Sheets', description: 'Spreadsheets', categories: ['PRODUCTIVITY'] }),
  ]
  it('empty query + empty category returns everything', () => {
    expect(filterPieces(pieces, '', '')).toHaveLength(3)
  })
  it('literal substring across name/displayName/description/categories', () => {
    expect(filterPieces(pieces, 'sheet', '').map((p) => p.name)).toEqual(['sheets'])
    expect(filterPieces(pieces, 'communication', '').map((p) => p.name)).toEqual(['slack', 'gmail'])
  })
  it('scopes by exact category', () => {
    expect(filterPieces(pieces, '', 'PRODUCTIVITY').map((p) => p.name)).toEqual(['sheets'])
    expect(filterPieces(pieces, 'send', 'COMMUNICATION').map((p) => p.name)).toEqual(['gmail'])
  })
  it('treats a regex-special query as a literal (ReDoS-safe)', () => {
    expect(filterPieces(pieces, '(a+)+', '')).toEqual([])
    expect(filterPieces(pieces, '.*', '')).toEqual([])
  })
})

describe('authLabel', () => {
  it('maps the auth descriptor to an honest label', () => {
    expect(authLabel({ auth: { type: 'oauth2', required: true } })).toBe('OAuth2')
    expect(authLabel({ auth: { type: 'secret_text', required: true } })).toBe('API key')
    expect(authLabel({ auth: { type: 'bot_token', required: true } })).toBe('Bot token')
    expect(authLabel({ auth: { type: 'none', required: false } })).toBe('No auth')
    expect(authLabel({ auth: { type: 'custom', required: true } })).toBe('custom')
  })
})

describe('capabilitySummary', () => {
  it('summarizes action + trigger counts with correct pluralization', () => {
    expect(capabilitySummary({ actions: [{ name: 'a', displayName: 'A', description: '' }], triggers: [] })).toBe('1 action')
    expect(
      capabilitySummary({
        actions: [{ name: 'a', displayName: 'A', description: '' }, { name: 'b', displayName: 'B', description: '' }],
        triggers: [{ name: 't', displayName: 'T', description: '' }],
      }),
    ).toBe('2 actions · 1 trigger')
    expect(capabilitySummary({ actions: [], triggers: [] })).toBe('')
  })
})

describe('formatWhen', () => {
  const now = 1_700_000_000_000
  it('returns an em-dash for a missing time, never a fabricated date', () => {
    expect(formatWhen(0, now)).toBe('—')
    expect(formatWhen(-5, now)).toBe('—')
  })
  it('renders honest relative times', () => {
    expect(formatWhen(now - 30_000, now)).toBe('just now')
    expect(formatWhen(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatWhen(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(formatWhen(now - 2 * 86_400_000, now)).toBe('2d ago')
  })
  it('falls back to an ISO date past a week', () => {
    expect(formatWhen(now - 30 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('validateFlowName', () => {
  it('requires a non-empty, bounded name', () => {
    expect(validateFlowName('')).toBe('Enter a name for the flow.')
    expect(validateFlowName('   ')).toBe('Enter a name for the flow.')
    expect(validateFlowName('My flow')).toBeNull()
    expect(validateFlowName('a'.repeat(MAX_FLOW_NAME + 1))).toMatch(/under/)
  })
})
