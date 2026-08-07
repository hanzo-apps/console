/**
 * Tests for the agent RUN feed — the half of the agents client that closes the
 * run → trace gap.
 *
 * Two layers, mirroring `o11y.test.ts`:
 *  (1) the PURE parsers — `normalizeRun`/`normalizeRuns` over the exact `RunView`
 *      wire shape, where every field but id/status/model/durationMs/createdAt is
 *      `omitempty` and may be ABSENT, and `traceHref`, the one guard that keeps an
 *      absent `traceId` from becoming a dead link.
 *  (2) the REAL `AgentsApi.runs` / `AgentsApi.agentRuns` over a stubbed fetch,
 *      pinning the URL the console actually requests: the served status filter is
 *      passed THROUGH (a UI-only filter would silently read the wrong window), the
 *      limit is clamped to the range the endpoint documents, and one agent's history
 *      is keyed on the NAME handle like every other single-agent route.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { AgentsApi, RUN_LIMIT_MAX, normalizeRun, normalizeRuns, traceHref } from './agents'

/** The full RunView, exactly as the backend marshals it when every field is set. */
const FULL = {
  id: 'run_7f3a',
  status: 'ok',
  model: 'zen5',
  input: 'summarize the incident',
  output: 'three services degraded',
  durationMs: 1840,
  createdAt: '2026-08-04T10:11:12Z',
  agent: 'triage',
  actor: 'z@hanzo.ai',
  traceId: 'trace_91b2',
  promptTokens: 1204,
  completionTokens: 318,
  toolCalls: 3,
}

// ── (1) pure parsers ─────────────────────────────────────────────────────────

describe('normalizeRun', () => {
  it('parses the full RunView shape field for field', () => {
    expect(normalizeRun(FULL)).toEqual({
      id: 'run_7f3a',
      status: 'ok',
      model: 'zen5',
      input: 'summarize the incident',
      output: 'three services degraded',
      error: undefined,
      durationMs: 1840,
      createdAt: '2026-08-04T10:11:12Z',
      agent: 'triage',
      actor: 'z@hanzo.ai',
      traceId: 'trace_91b2',
      promptTokens: 1204,
      completionTokens: 318,
      toolCalls: 3,
    })
  })

  it('leaves every omitempty field absent rather than inventing one', () => {
    // The minimum the contract guarantees is always written.
    const r = normalizeRun({ id: 'run_1', status: 'ok', model: 'zen5', durationMs: 12, createdAt: '2026-08-04T00:00:00Z' })
    expect(r).not.toBeNull()
    expect(r?.traceId).toBeUndefined()
    expect(r?.agent).toBeUndefined()
    expect(r?.actor).toBeUndefined()
    expect(r?.input).toBeUndefined()
    expect(r?.output).toBeUndefined()
    expect(r?.error).toBeUndefined()
    expect(r?.promptTokens).toBeUndefined()
    expect(r?.completionTokens).toBeUndefined()
    expect(r?.toolCalls).toBeUndefined()
  })

  it('carries an error run with its message', () => {
    const r = normalizeRun({ ...FULL, status: 'error', error: 'tool timeout', output: '' })
    expect(r?.status).toBe('error')
    expect(r?.error).toBe('tool timeout')
    expect(r?.output).toBeUndefined()
  })

  it('never reads a run with a recorded error as a success', () => {
    // A missing/unknown status must not dress a failure as "ok".
    expect(normalizeRun({ id: 'run_1', error: 'boom' })?.status).toBe('error')
    expect(normalizeRun({ id: 'run_1' })?.status).toBe('ok')
  })

  it('drops a row with no id (it could not be opened)', () => {
    expect(normalizeRun({ status: 'ok', model: 'zen5' })).toBeNull()
    expect(normalizeRun(null)).toBeNull()
  })

  it('reads a snake_case payload too (defensive against a wire rename)', () => {
    const r = normalizeRun({
      id: 'run_1',
      status: 'ok',
      duration_ms: 90,
      created_at: '2026-08-04T00:00:00Z',
      trace_id: 't1',
      prompt_tokens: 10,
      completion_tokens: 5,
      tool_calls: 1,
    })
    expect(r).toMatchObject({ durationMs: 90, createdAt: '2026-08-04T00:00:00Z', traceId: 't1', promptTokens: 10, completionTokens: 5, toolCalls: 1 })
  })
})

describe('normalizeRuns', () => {
  it('reads the documented { runs: [...] } envelope', () => {
    expect(normalizeRuns({ runs: [FULL] }).map((r) => r.id)).toEqual(['run_7f3a'])
  })

  it('orders newest first', () => {
    const rows = normalizeRuns({
      runs: [
        { id: 'old', createdAt: '2026-08-01T00:00:00Z' },
        { id: 'new', createdAt: '2026-08-04T00:00:00Z' },
        { id: 'mid', createdAt: '2026-08-02T00:00:00Z' },
      ],
    })
    expect(rows.map((r) => r.id)).toEqual(['new', 'mid', 'old'])
  })

  it('degrades to an empty list rather than throwing on garbage', () => {
    expect(normalizeRuns(null)).toEqual([])
    expect(normalizeRuns({ runs: 'nope' })).toEqual([])
    expect(normalizeRuns({})).toEqual([])
  })
})

describe('traceHref — an absent trace is never a dead link', () => {
  it('is null when the run recorded no traceId', () => {
    // The gap this whole surface closes: a run from before tracing existed has no
    // trace. That is a different fact from an error, and it must not render a link.
    expect(traceHref({ traceId: undefined })).toBeNull()
    expect(traceHref({ traceId: '' })).toBeNull()
    const noTrace = normalizeRun({ id: 'run_1', status: 'ok', model: 'zen5', durationMs: 1, createdAt: '2026-08-04T00:00:00Z' })
    expect(traceHref(noTrace!)).toBeNull()
  })

  it('points at the existing trace waterfall when the run recorded one', () => {
    expect(traceHref({ traceId: 'trace_91b2' })).toBe('/o11y/trace_91b2')
  })

  it('URL-encodes a trace id with reserved characters', () => {
    expect(traceHref({ traceId: 'a b/c' })).toBe('/o11y/a%20b%2Fc')
  })
})

// ── (2) the real transport ───────────────────────────────────────────────────

describe('AgentsApi run reads — the URL the console actually requests', () => {
  const ORIGIN = 'https://console.hanzo.ai'
  let calls: string[] = []

  beforeEach(() => {
    calls = []
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
    }
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url)
      return Promise.resolve(
        new Response(JSON.stringify({ runs: [FULL] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('reads the org-wide feed at /v1/agents/runs', async () => {
    const rows = await AgentsApi.runs()
    expect(calls).toEqual([`${ORIGIN}/v1/agents/runs`])
    expect(rows[0]).toMatchObject({ id: 'run_7f3a', traceId: 'trace_91b2' })
  })

  it('passes the status filter THROUGH to the backend', async () => {
    await AgentsApi.runs({ status: 'error' })
    expect(calls[0]).toBe(`${ORIGIN}/v1/agents/runs?status=error`)
    await AgentsApi.runs({ limit: 50, status: 'ok' })
    expect(calls[1]).toBe(`${ORIGIN}/v1/agents/runs?limit=50&status=ok`)
  })

  it('sends no status param for "all" — the backend serves both', async () => {
    await AgentsApi.runs({ limit: 50, status: 'all' })
    expect(calls[0]).toBe(`${ORIGIN}/v1/agents/runs?limit=50`)
  })

  it('clamps limit to the range the endpoint serves (1..200)', async () => {
    await AgentsApi.runs({ limit: 5000 })
    expect(calls[0]).toBe(`${ORIGIN}/v1/agents/runs?limit=${RUN_LIMIT_MAX}`)
    await AgentsApi.runs({ limit: 0 })
    expect(calls[1]).toBe(`${ORIGIN}/v1/agents/runs?limit=1`)
  })

  it('reads one agent history at /v1/agents/:ref/runs, keyed on the name handle', async () => {
    await AgentsApi.agentRuns('triage', { limit: 20 })
    expect(calls[0]).toBe(`${ORIGIN}/v1/agents/triage/runs?limit=20`)
    await AgentsApi.agentRuns('a b/c')
    expect(calls[1]).toBe(`${ORIGIN}/v1/agents/a%20b%2Fc/runs`)
  })
})
