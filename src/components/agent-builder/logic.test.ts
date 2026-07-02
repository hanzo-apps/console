import { describe, it, expect } from 'vitest'

import {
  emptySpec,
  defaultConfig,
  defaultModel,
  canSubmit,
  normalizeList,
  normalizeTools,
  normalizeKnowledge,
  clampConfig,
  pruneConfig,
  toCreateBody,
  promptBodyFromRow,
  promptOptions,
  classifyBuilderError,
} from './logic'
import type { AgentConfig, AgentSpec, BuilderOption, BuilderPrompt } from './types'

const spec = (over: Partial<AgentSpec> = {}): AgentSpec => ({ ...emptySpec(), ...over })

describe('emptySpec', () => {
  it('is a clean, empty spec', () => {
    expect(emptySpec()).toEqual({ name: '', model: '', description: '', systemPrompt: '', tools: [] })
  })
})

describe('defaultModel', () => {
  const opt = (value: string, hint?: string): BuilderOption => ({ value, hint })

  it('returns "" for an empty catalog (nothing to default to)', () => {
    expect(defaultModel([])).toBe('')
  })

  it('prefers the exact zen-omni default when present', () => {
    expect(defaultModel([opt('gpt-4o'), opt('zen-omni'), opt('claude')])).toBe('zen-omni')
  })

  it('falls back to the first Zen-family model (prefix or provider hint)', () => {
    expect(defaultModel([opt('gpt-4o'), opt('zen-coder')])).toBe('zen-coder')
    expect(defaultModel([opt('gpt-4o'), opt('some-model', 'Zen')])).toBe('some-model')
  })

  it('falls back to the first catalog id when no Zen model exists', () => {
    expect(defaultModel([opt('gpt-4o'), opt('claude')])).toBe('gpt-4o')
  })

  it('never invents an id outside the catalog', () => {
    const d = defaultModel([opt('only-model')])
    expect(['only-model']).toContain(d)
  })
})

describe('canSubmit', () => {
  it('requires a non-empty trimmed name', () => {
    expect(canSubmit(spec({ name: '' }))).toBe(false)
    expect(canSubmit(spec({ name: '   ' }))).toBe(false)
    expect(canSubmit(spec({ name: 'triage' }))).toBe(true)
  })
})

describe('normalizeList / normalizeTools / normalizeKnowledge', () => {
  it('trims, drops blanks, and de-duplicates preserving first-seen order', () => {
    expect(normalizeList([' a ', 'b', 'a', '', '  '])).toEqual(['a', 'b'])
  })
  it('normalizeTools + normalizeKnowledge share the one behavior (DRY)', () => {
    const raw = [' web.search ', 'code.exec', 'web.search', '', '  ']
    expect(normalizeTools(raw)).toEqual(['web.search', 'code.exec'])
    expect(normalizeKnowledge([' kb:1 ', 'kb:2', 'kb:1'])).toEqual(['kb:1', 'kb:2'])
  })
})

describe('defaultConfig', () => {
  it('is the documented generation default', () => {
    expect(defaultConfig()).toEqual({
      temperature: 0.7,
      topP: 1,
      topK: 0,
      stream: true,
      thinking: false,
      useTools: true,
      webSearch: false,
    })
  })
  it('is a fresh object each call (no shared mutable state)', () => {
    const a = defaultConfig()
    a.temperature = 2
    expect(defaultConfig().temperature).toBe(0.7)
  })
})

describe('clampConfig', () => {
  const base = defaultConfig()
  it('clamps temperature into [0,2]', () => {
    expect(clampConfig({ ...base, temperature: 9 }).temperature).toBe(2)
    expect(clampConfig({ ...base, temperature: -1 }).temperature).toBe(0)
  })
  it('clamps topP into [0,1] and topK to a non-negative integer', () => {
    expect(clampConfig({ ...base, topP: 5 }).topP).toBe(1)
    expect(clampConfig({ ...base, topP: -0.5 }).topP).toBe(0)
    expect(clampConfig({ ...base, topK: -3 }).topK).toBe(0)
    expect(clampConfig({ ...base, topK: 7.9 }).topK).toBe(7)
  })
  it('maps NaN → min but clamps ±∞ to the nearest bound', () => {
    expect(clampConfig({ ...base, temperature: NaN }).temperature).toBe(0) // garbage → min
    expect(clampConfig({ ...base, topP: Infinity }).topP).toBe(1) // slider-to-top → max
    expect(clampConfig({ ...base, temperature: -Infinity }).temperature).toBe(0) // → min bound
  })
})

describe('pruneConfig', () => {
  it('returns undefined when every knob is at its default (simple agent posts no config)', () => {
    expect(pruneConfig(defaultConfig())).toBeUndefined()
  })
  it('returns ONLY the knobs that differ from default', () => {
    expect(pruneConfig({ ...defaultConfig(), temperature: 0.2, thinking: true })).toEqual({
      temperature: 0.2,
      thinking: true,
    })
  })
  it('clamps before diffing (an out-of-range value that clamps to default prunes away)', () => {
    // topP default is 1; a value of 5 clamps to 1 → same as default → pruned out.
    expect(pruneConfig({ ...defaultConfig(), topP: 5 })).toBeUndefined()
  })
  it('carries reasoningEffort across the full ladder when set (it has no default)', () => {
    expect(pruneConfig({ ...defaultConfig(), reasoningEffort: 'high' })).toEqual({ reasoningEffort: 'high' })
    // The top tier — "xhigh + workflows" — survives pruning like any other level.
    expect(pruneConfig({ ...defaultConfig(), reasoningEffort: 'ultracode' })).toEqual({ reasoningEffort: 'ultracode' })
  })
})

describe('toCreateBody', () => {
  it('trims name and omits empty optional fields', () => {
    expect(toCreateBody(spec({ name: '  triage  ' }))).toEqual({ name: 'triage' })
  })

  it('includes only the non-empty fields, with normalized tools', () => {
    const body = toCreateBody(
      spec({ name: 'triage', model: ' zen-omni ', description: '', systemPrompt: ' be terse ', tools: ['a', 'a', ' '] }),
    )
    expect(body).toEqual({ name: 'triage', model: 'zen-omni', systemPrompt: 'be terse', tools: ['a'] })
    expect(body).not.toHaveProperty('description')
  })

  it('omits an empty tools array (no key the backend didn’t need)', () => {
    expect(toCreateBody(spec({ name: 'x', tools: [] }))).not.toHaveProperty('tools')
  })
})

describe('promptBodyFromRow', () => {
  const rows: BuilderPrompt[] = [
    { name: 'with-body', body: 'you are helpful' },
    { name: 'no-body' },
  ]
  it('returns the inline body when present', () => {
    expect(promptBodyFromRow(rows, 'with-body')).toBe('you are helpful')
  })
  it('returns null when the row has no body (caller must fetch it)', () => {
    expect(promptBodyFromRow(rows, 'no-body')).toBeNull()
  })
  it('returns null for an unknown name', () => {
    expect(promptBodyFromRow(rows, 'missing')).toBeNull()
  })
})

describe('promptOptions', () => {
  it('maps prompts to picker rows (value=name, label defaults to name)', () => {
    expect(promptOptions([{ name: 'triage' }, { name: 'router', label: 'Router', hint: 'chat' }])).toEqual([
      { value: 'triage', label: 'triage', hint: undefined },
      { value: 'router', label: 'Router', hint: 'chat' },
    ])
  })
})

describe('classifyBuilderError', () => {
  it('classifies a 404 / 501 as "unavailable" (route not bound)', () => {
    expect(classifyBuilderError({ status: 404 }).kind).toBe('unavailable')
    expect(classifyBuilderError({ status: 501 }).kind).toBe('unavailable')
  })
  it('classifies an explicit "unavailable" BackendState kind as unavailable', () => {
    expect(classifyBuilderError({ kind: 'unavailable', message: 'x' }).kind).toBe('unavailable')
  })
  it('classifies other errors as real errors and surfaces the message', () => {
    const c = classifyBuilderError({ status: 400, message: 'name is required' })
    expect(c.kind).toBe('error')
    expect(c.message).toBe('name is required')
  })
  it('has a safe default message for an opaque error', () => {
    expect(classifyBuilderError('boom')).toEqual({ kind: 'error', message: 'Could not create the agent.' })
  })
})
