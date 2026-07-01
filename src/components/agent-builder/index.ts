/**
 * Canonical Hanzo agent builder — the ONE agent builder, shareable across every
 * surface (console, chat, app, bot, team).
 *
 * A host imports `AgentBuilder` and supplies `AgentBuilderLoaders` (its own live
 * `/v1` sources — model catalog, saved prompts, create) over the SAME agent backend
 * (`POST /v1/agents`, org resolved server-side). The component, its schema
 * (`AgentSpec`), and all pure logic live here with NO host coupling, so this module
 * lifts cleanly into a published `@hanzo/agent-builder` package.
 */
export { AgentBuilder } from './AgentBuilder'
export type {
  AgentSpec,
  AgentBuilderLoaders,
  BuilderOption,
  BuilderPrompt,
  BuilderError,
  BuilderErrorKind,
} from './types'
export {
  emptySpec,
  defaultModel,
  canSubmit,
  normalizeTools,
  toCreateBody,
  promptBodyFromRow,
  promptOptions,
  classifyBuilderError,
} from './logic'
