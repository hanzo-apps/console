/**
 * Agent-builder pure logic — the decisions the form makes, with no React and no
 * network, so they are unit-tested in isolation (the UI just renders these).
 *
 * The create body is trimmed + pruned here: empty optional fields are dropped so
 * the backend stores clean values, and only a non-empty `name` makes a spec valid.
 * A saved-prompt pick fills the system prompt; the tools list is de-duplicated and
 * blank-stripped. Everything here is a value transform — no side effects.
 */
import type { AgentSpec, BuilderError, BuilderOption, BuilderPrompt } from './types'

/** A fresh, empty spec (the New-Agent form's initial state). PURE. */
export function emptySpec(): AgentSpec {
  return { name: '', model: '', description: '', systemPrompt: '', tools: [] }
}

/** The default Zen model to preselect when the catalog offers one. */
const ZEN_DEFAULT = 'zen-omni'

/**
 * Pick a sensible default model from a live catalog: the Zen default if present,
 * else the first Zen (`hanzo`-owned / `zen-` prefixed) model, else the first
 * catalog id, else '' (nothing to default to — the field stays empty/typeable).
 * PURE. Never invents an id — only returns one the catalog actually lists.
 */
export function defaultModel(options: BuilderOption[]): string {
  if (options.length === 0) return ''
  const exact = options.find((o) => o.value === ZEN_DEFAULT)
  if (exact) return exact.value
  const zen = options.find(
    (o) => /^zen[-.]/i.test(o.value) || (o.hint ?? '').toLowerCase().includes('zen'),
  )
  return (zen ?? options[0]).value
}

/** True iff the spec can be submitted (a non-empty trimmed name is the only requirement). */
export function canSubmit(spec: AgentSpec): boolean {
  return spec.name.trim().length > 0
}

/** De-duplicate + blank-strip a tool list, preserving first-seen order. PURE. */
export function normalizeTools(tools: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tools) {
    const t = raw.trim()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

/**
 * The clean create body for `POST /cloud/v1/agents`: name is trimmed (required);
 * every other field is trimmed and OMITTED when empty, and tools are normalized —
 * so the backend never stores a blank model/description/prompt or a `[]` tools
 * key it didn't need. PURE.
 */
export function toCreateBody(spec: AgentSpec): AgentSpec | Record<string, unknown> {
  const name = spec.name.trim()
  const model = spec.model.trim()
  const description = spec.description.trim()
  const systemPrompt = spec.systemPrompt.trim()
  const tools = normalizeTools(spec.tools)
  return {
    name,
    ...(model ? { model } : {}),
    ...(description ? { description } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(tools.length ? { tools } : {}),
  }
}

/**
 * Resolve the body a saved-prompt pick should put into `systemPrompt`: the row's
 * own `body` when present, else null (the caller must `loadPromptBody(name)`).
 * PURE — no fetch here.
 */
export function promptBodyFromRow(prompts: BuilderPrompt[], name: string): string | null {
  const row = prompts.find((p) => p.name === name)
  return row?.body != null ? row.body : null
}

/** Map saved prompts to picker rows (label = name, hint = any provided hint). PURE. */
export function promptOptions(prompts: BuilderPrompt[]): BuilderOption[] {
  return prompts.map((p) => ({ value: p.name, label: p.label ?? p.name, hint: p.hint }))
}

/**
 * Classify a create failure. A 404 (or an explicit "unavailable" BackendState kind)
 * means the `/v1/agents` route isn't bound on this deployment — an honest "not
 * connected, use the CLI" state, NOT a scary error. Anything else is a real error
 * whose message is surfaced. PURE (reads status/kind/message off the error object).
 */
export function classifyBuilderError(e: unknown): BuilderError {
  const status = statusOf(e)
  const kind = kindOf(e)
  if (status === 404 || status === 501 || kind === 'unavailable') {
    return { kind: 'unavailable', message: 'The agents API is not connected on this deployment yet.' }
  }
  return { kind: 'error', message: messageOf(e) }
}

// ── error-shape readers (defensive; the builder is client-agnostic) ──────────

function statusOf(e: unknown): number | undefined {
  if (e && typeof e === 'object' && 'status' in e) {
    const s = (e as { status?: unknown }).status
    if (typeof s === 'number') return s
  }
  return undefined
}

function kindOf(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'kind' in e) {
    const k = (e as { kind?: unknown }).kind
    if (typeof k === 'string') return k
  }
  return undefined
}

function messageOf(e: unknown): string {
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
  }
  return 'Could not create the agent.'
}
