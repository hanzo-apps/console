/**
 * Request preview — the REAL request body for the current composer, as JSON or a
 * runnable cURL (the header "</>" / code action).
 *
 * Built from the SAME `paramsOf` mapping the run uses, so what is shown is what is
 * sent — every field present is a real field the OpenAI-compatible gateway
 * accepts, and an omitted field is genuinely omitted (gateway default), never a
 * fabricated value. The cURL targets the public gateway with a bearer placeholder
 * (`$HANZO_API_KEY`), so a developer can copy, paste a real `sk-` key, and run it.
 */
import type { RunParams } from './params'

/** The public gateway endpoint a copied cURL targets (an `sk-` key works here). */
export const GATEWAY_URL = 'https://api.hanzo.ai/v1/chat/completions'

/** A message as shown in the preview (text or multimodal content). */
export type PreviewMessage = { role: string; content: unknown }

/** Assemble the request body: model + messages + only the params that are set. */
export function buildRequestBody(
  model: string,
  messages: PreviewMessage[],
  params: RunParams,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: params.temperature,
    top_p: params.top_p,
  }
  if (params.max_tokens !== undefined) body.max_tokens = params.max_tokens
  if (params.stop !== undefined) body.stop = params.stop
  if (params.frequency_penalty !== undefined) body.frequency_penalty = params.frequency_penalty
  if (params.presence_penalty !== undefined) body.presence_penalty = params.presence_penalty
  if (params.seed !== undefined) body.seed = params.seed
  return body
}

/** Pretty-printed JSON of a request body. */
export function toJson(body: Record<string, unknown>): string {
  return JSON.stringify(body, null, 2)
}

/** A runnable cURL for a request body (single-quoted JSON, shell-escaped). */
export function toCurl(body: Record<string, unknown>, url = GATEWAY_URL): string {
  const json = JSON.stringify(body).replace(/'/g, "'\\''")
  return [
    `curl ${url} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Authorization: Bearer $HANZO_API_KEY' \\`,
    `  -d '${json}'`,
  ].join('\n')
}
