/**
 * Canonical agent-builder contract — the ONE way to describe and build a Hanzo
 * agent, shared across every surface (console, chat, app, bot, team).
 *
 * This file has NO console2 coupling on purpose: it imports nothing from `~/lib`
 * or any host app. The builder takes its data + effects as INJECTED async
 * loaders (`AgentBuilderLoaders`) — the model catalog, the saved-prompt library,
 * a prompt body, and the create effect — so a surface wires it to whatever client
 * it already has, as long as that client speaks the ONE agent backend
 * (`POST /cloud/v1/agents`, org resolved server-side from the caller's bearer).
 * That is what makes the builder truly shareable (extractable to
 * `@hanzo/agent-builder`) rather than a console2 one-off.
 */

/** The editable shape of an agent under construction (the form's state). */
export type AgentSpec = {
  /** Org-unique handle (also the URL segment). Required. */
  name: string
  /** Backing model id (a live catalog id or a custom one). */
  model: string
  /** One-line description of what the agent does. */
  description: string
  /** The system prompt — typed free-form OR loaded from a saved prompt. */
  systemPrompt: string
  /** Tool ids the agent may call (live catalog and/or custom). */
  tools: string[]
}

/** One option in a live picker (model / prompt / tool). Mirrors the ComboBox option. */
export type BuilderOption = {
  /** The value committed to the spec when chosen. */
  value: string
  /** Display label (defaults to `value`). */
  label?: string
  /** Optional secondary text (provider, description) — shown + searched. */
  hint?: string
}

/**
 * A saved prompt as the builder needs it: a name to pick by, and — when the list
 * carries it — the body to fill the system prompt. When `body` is absent the
 * builder fetches it lazily via `loadPromptBody(name)`.
 */
export type BuilderPrompt = {
  name: string
  /** The prompt body, if the list row already carries it (else fetched on select). */
  body?: string
  /** Optional label (defaults to name) + hint (labels/type). */
  label?: string
  hint?: string
}

/**
 * The effects + data the builder needs, injected by the host surface. Every loader
 * is async and may reject; the builder renders honest loading/error states and
 * NEVER fabricates an option. All four are optional except `createAgent`:
 *   - no `loadModels`  → the model field is a plain typeable input (still works).
 *   - no `loadPrompts` → the prompt selector is hidden (system prompt stays free-text).
 *   - no `loadTools`   → the tools field is typeable-only (no live options).
 */
export type AgentBuilderLoaders = {
  /** The live model catalog (ids the gateway accepts). Rejects → typeable fallback. */
  loadModels?: () => Promise<BuilderOption[]>
  /** The org's saved prompts (names + optional bodies). Rejects → selector hidden. */
  loadPrompts?: () => Promise<BuilderPrompt[]>
  /** Fetch ONE saved prompt's body by name (used when the list row lacks it). */
  loadPromptBody?: (name: string) => Promise<string>
  /** The live tool catalog. Rejects → typeable-only tools. */
  loadTools?: () => Promise<BuilderOption[]>
  /**
   * Create the agent from the finished spec. This is the ONE mutation — it MUST
   * target the unified agent backend (`POST /cloud/v1/agents`), which resolves the
   * org from the caller's bearer server-side. Rejects with the backend error
   * (the builder classifies 404 as "not connected" honestly).
   */
  createAgent: (spec: AgentSpec) => Promise<unknown>
}

/** The reason a create failed, distinguished so the UI reacts correctly. */
export type BuilderErrorKind =
  /** The `/v1/agents` route isn't bound on this deployment yet (404). */
  | 'unavailable'
  /** A real error (validation, auth, upstream) — show the message. */
  | 'error'

/** A classified builder error: a kind plus a human message. */
export type BuilderError = { kind: BuilderErrorKind; message: string }
