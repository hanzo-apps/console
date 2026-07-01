/**
 * console2's wiring of the CANONICAL agent builder — the injection point where the
 * shared `AgentBuilder` (which knows no host client) meets console2's `/v1` clients.
 *
 * This is the ONLY console2-specific glue: it maps the builder's four injected
 * loaders onto the console's live sources, all over the ONE backend contract —
 *   - models  → `PlaygroundApi.listModels()`  (same-origin `/v1/models`, gateway)
 *   - prompts → `PromptsApi.list()` + `.get()` (same-origin `/v1/prompts`, org-scoped)
 *   - create  → `AgentsApi.create()`           (same-origin `/v1/agents`, org-scoped)
 * Another surface (chat, app, bot) would provide its OWN `agentBuilderLoaders`
 * against the SAME `/v1/agents` — the component itself is identical everywhere.
 */
import { PlaygroundApi, PromptsApi } from '~/lib/api'
import { AgentsApi } from '~/lib/api/agents'
import type { AgentBuilderLoaders, AgentSpec, BuilderOption, BuilderPrompt } from '~/components/agent-builder/types'

/** The live model catalog as builder options (id → {value,label,hint}). */
async function loadModels(): Promise<BuilderOption[]> {
  const ids = await PlaygroundApi.listModels() // sorted, de-duplicated live catalog
  return ids.map((id) => ({ value: id, label: id }))
}

/** The org's saved prompts as builder rows (names; bodies fetched lazily on select). */
async function loadPrompts(): Promise<BuilderPrompt[]> {
  const prompts = await PromptsApi.list()
  return prompts.map((p) => ({
    name: p.name,
    label: p.name,
    hint: [p.type, p.labels?.join(' · ')].filter(Boolean).join(' · ') || undefined,
  }))
}

/**
 * Fetch one saved prompt's body to fill the system prompt. The list rows carry
 * metadata, not the text, so this reads the detail payload and extracts the most
 * likely body field defensively (the backend detail shape isn't a fixed contract),
 * falling back to the pretty-printed payload so the user always gets SOMETHING real
 * to edit rather than an empty box.
 */
async function loadPromptBody(name: string): Promise<string> {
  const detail = await PromptsApi.get(name)
  return extractBody(detail)
}

/** Best-effort body extraction from a prompt detail payload. PURE-ish (no I/O). */
export function extractBody(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const r = detail as Record<string, unknown>
    // Common single-body fields, then the latest version's body if versioned.
    for (const k of ['prompt', 'body', 'text', 'content', 'systemPrompt', 'system']) {
      const v = r[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    const versions = r.versions ?? r.history
    if (Array.isArray(versions) && versions.length) {
      const last = versions[versions.length - 1]
      if (last && typeof last === 'object') {
        for (const k of ['prompt', 'body', 'text', 'content']) {
          const v = (last as Record<string, unknown>)[k]
          if (typeof v === 'string' && v.trim()) return v
        }
      }
    }
    return JSON.stringify(detail, null, 2)
  }
  return ''
}

/** console2's injected loaders for the canonical `AgentBuilder`. */
export const agentBuilderLoaders: AgentBuilderLoaders = {
  loadModels,
  loadPrompts,
  loadPromptBody,
  // No live tool catalog endpoint on this deployment yet — the builder's tools
  // field stays typeable-only (honest), never a fabricated tool list. Wire
  // `loadTools` here when `/v1/agents/tools` (or the MCP tool catalog) is bound.
  createAgent: (spec: AgentSpec) => AgentsApi.create(spec),
}
