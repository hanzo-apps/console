import { describe, expect, it } from 'vitest'

import { curlFor, eventsFrom, hanzoCli, inspectorRoute, parseCommand, renderOutput } from './logic'

describe('parseCommand', () => {
  it('accepts every documented form and normalizes to a /v1-relative path', () => {
    expect(parseCommand('GET /v1/models')).toEqual({ path: 'models' })
    expect(parseCommand('get v1/models')).toEqual({ path: 'models' })
    expect(parseCommand('/v1/models')).toEqual({ path: 'models' })
    expect(parseCommand('models')).toEqual({ path: 'models' })
    expect(parseCommand('  agents?limit=5  ')).toEqual({ path: 'agents?limit=5' })
  })

  it('is read-only — every mutating method is refused', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(parseCommand(`${m} /v1/agents`)).toHaveProperty('error')
    }
  })

  it('refuses empty, multi-path, traversal, and smuggled inputs', () => {
    expect(parseCommand('')).toHaveProperty('error')
    expect(parseCommand('GET')).toHaveProperty('error')
    expect(parseCommand('/v1')).toHaveProperty('error')
    expect(parseCommand('GET /v1/a /v1/b')).toHaveProperty('error')
    expect(parseCommand('/v1/../admin')).toHaveProperty('error')
    expect(parseCommand('//evil.com/x')).toHaveProperty('error')
    expect(parseCommand('https://evil.com/x')).toHaveProperty('error')
  })
})

describe('renderOutput', () => {
  it('pretty-prints JSON and passes strings through', () => {
    expect(renderOutput({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(renderOutput('plain')).toBe('plain')
  })

  it('truncates a huge payload with an honest marker', () => {
    const out = renderOutput('x'.repeat(25000), 100)
    expect(out.startsWith('x'.repeat(100))).toBe(true)
    expect(out).toContain('24900 more characters truncated')
  })
})

describe('inspectorRoute', () => {
  it('routes each id prefix to the right /v1 GET', () => {
    expect(inspectorRoute('agent_abc')).toEqual({ path: 'agents/agent_abc', kind: 'agent', label: 'Agent' })
    expect(inspectorRoute('fn_hello')).toEqual({ path: 'functions/fn_hello', kind: 'function', label: 'Function' })
    expect(inspectorRoute('flow_1')).toEqual({ path: 'automations/flows/flow_1', kind: 'flow', label: 'Automation flow' })
    expect(inspectorRoute('run_9')).toEqual({ path: 'automations/runs/run_9', kind: 'run', label: 'Automation run' })
    expect(inspectorRoute('prompt_x')).toEqual({ path: 'prompts/prompt_x', kind: 'prompt', label: 'Prompt' })
    expect(inspectorRoute('trace_z')).toEqual({ path: 'o11y/traces/trace_z', kind: 'trace', label: 'Trace' })
  })

  it('maps an hk-/sk-/pk- key to the account key status (never a secret path)', () => {
    for (const k of ['hk-abc', 'sk-live-xyz', 'pk-123']) {
      expect(inspectorRoute(k)).toEqual({ path: 'iam/keys', kind: 'key', label: 'API key' })
    }
  })

  it('accepts a raw resource/name path as the fallback', () => {
    expect(inspectorRoute('agents/my-agent')).toEqual({ path: 'agents/my-agent', kind: 'resource', label: 'Resource' })
    expect(inspectorRoute('/v1/models/zen5')).toEqual({ path: 'models/zen5', kind: 'resource', label: 'Resource' })
  })

  it('refuses empty, a URL, traversal, and an unrecognized bare token', () => {
    expect(inspectorRoute('')).toHaveProperty('error')
    expect(inspectorRoute('https://evil.com/x')).toHaveProperty('error')
    expect(inspectorRoute('agents/../admin')).toHaveProperty('error')
    expect(inspectorRoute('justaword')).toHaveProperty('error')
  })
})

describe('show code', () => {
  it('builds a real curl with the bearer key, from any path form', () => {
    expect(curlFor('models')).toBe('curl https://api.hanzo.ai/v1/models \\\n  -H "Authorization: Bearer $HANZO_API_KEY"')
    expect(curlFor('/v1/agents')).toContain('https://api.hanzo.ai/v1/agents')
  })
  it('builds the Hanzo CLI form', () => {
    expect(hanzoCli('/v1/models')).toBe('hanzo api get /v1/models')
    expect(hanzoCli('agents')).toBe('hanzo api get /v1/agents')
  })
})

describe('eventsFrom', () => {
  const rec = (o: Partial<Parameters<typeof eventsFrom>[0][number]>) => ({
    id: 'i', requestId: '', model: '', product: '', agent: '', status: '', cents: 0, at: null, ...o,
  })

  it('projects ledger rows into typed platform events, newest first', () => {
    const out = eventsFrom([
      rec({ id: 'a', model: 'zen5', status: 'success', at: 100, cents: 12 }),
      rec({ id: 'b', model: 'glm', status: 'error', at: 300 }),
      rec({ id: 'c', agent: 'bot', status: 'success', at: 200 }),
    ])
    expect(out.map((e) => e.id)).toEqual(['b', 'c', 'a']) // newest first (300,200,100)
    expect(out[0].type).toBe('request.failed')
    expect(out[1].type).toBe('agent.run.succeeded')
    expect(out[2].type).toBe('request.succeeded')
  })

  it('prefers the gateway requestId as the event id and is honest-empty', () => {
    expect(eventsFrom([rec({ id: 'x', requestId: 'req_1', at: 1 })])[0].id).toBe('req_1')
    expect(eventsFrom([])).toEqual([])
  })
})
