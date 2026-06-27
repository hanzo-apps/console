/**
 * Bot API — liveness of the Hanzo Bot gateway (hanzoai/bot → bot-gateway).
 *
 * The bot is a routed sub-service behind the unified gateway at /v1/bot/* — an
 * OpenAI-compatible agent gateway with channels, skills, and a control UI. Like
 * the provisioning service, it speaks plain JSON (NOT the casibase envelope), so
 * it rides the REST layer.
 *
 *   GET /v1/bot/health -> 200 { ok, status }
 */
import { restGet, v1Url } from './client'

/** Gateway health as reported by /v1/bot/health (plain JSON, not the envelope). */
export type BotHealth = {
  ok: boolean
  status: string
}

export const BotApi = {
  health: () => restGet<BotHealth>(v1Url('bot/health')),
}
