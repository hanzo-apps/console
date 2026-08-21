/**
 * Bot API — liveness of the Hanzo Bot runtime (hanzoai/bot).
 *
 * The bot is a routed sub-service behind the unified gateway at /v1/bot/* — an
 * OpenAI-compatible agent gateway with channels, skills, and a control UI. Like
 * the provisioning service, it speaks plain JSON (NOT the casibase envelope), so
 * it rides the REST layer.
 *
 * A liveness probe is not a tenant-scoped resource, so it is not reimplemented in
 * cloud: `/v1/bot/runtime/*` relays the runtime's own ops paths verbatim, stripping
 * the prefix, so this reaches the runtime as `/health`. Everything a tenant can ACT
 * on is native and typed at /v1/bot/runs (HIP-0139).
 *
 *   GET /v1/bot/runtime/health -> 200 { ok, status }
 */
import { restGet, v1Url } from './client'

/** Runtime health as reported by /v1/bot/runtime/health (plain JSON, not the envelope). */
export type BotHealth = {
  ok: boolean
  status: string
}

export const BotApi = {
  health: () => restGet<BotHealth>(v1Url('bot/runtime/health')),
}
