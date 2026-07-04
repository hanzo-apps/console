/**
 * default-model — the pure policy for the playground's initial model pick, kept
 * separate from the effectful React catalog hook (`useModels`) so it has ONE home
 * and is unit-testable in plain Node.
 *
 * The default is our latest PROMOTED Zen flagship, ready-to-Run:
 *   1) honor an explicit catalog promotion (`featured`) — so the pick auto-tracks
 *      whatever we promote next (zen6…) with NO code change;
 *   2) else the Zen flagship by name — the newest major (`zen5`), preferring the
 *      bare family id over a smaller/specialized tier (`-mini`/`-flash`/`-coder`);
 *   3) else any servable text model, then the first catalog entry.
 * Auxiliary (embedding/audio/image) models are skipped for the chat default.
 */
import type { ModelOption } from './useModels'

/** Non-chat modalities skipped for the chat default. */
const AUX = /(embed|tts|whisper|speech|rerank|image|diffusion|flux|dall|guard|moderation)/i
/** Smaller/specialized tiers we never auto-default to over the bare flagship. */
const SUB_TIER = /(mini|flash|nano|lite|air|coder|instruct|embed|tts|whisper|speech|rerank|image|vision|guard)/i

/** A first-party Zen model (by id or provider). */
const isZen = (o: ModelOption): boolean => /zen/i.test(o.id) || o.provider.toLowerCase() === 'zen'

/**
 * Rank Zen models so the flagship wins: newest major first (so a future `zen6`
 * auto-outranks `zen5`), then the bare family id (`zen5`) over a named tier
 * (`zen5-pro`) over a smaller/specialized tier (`zen5-mini`/`-flash`/`-coder`).
 */
function flagshipZen(zen: ModelOption[]): ModelOption | undefined {
  if (zen.length === 0) return undefined
  const score = (o: ModelOption): number => {
    const id = o.id.toLowerCase()
    const major = Number(id.match(/zen[-_]?(\d+)/)?.[1] ?? 0)
    const tier = SUB_TIER.test(id) ? 0 : /zen[-_]?\d+[-_.]/.test(id) ? 1 : 2 // sub < named < bare
    return major * 10 + tier
  }
  return [...zen].sort((a, b) => score(b) - score(a))[0]
}

/**
 * The playground's default model id — the latest promoted Zen flagship (see the
 * module docstring). Returns '' only for an empty catalog.
 */
export function defaultModelId(options: ModelOption[]): string {
  if (options.length === 0) return ''
  const text = options.filter((o) => !AUX.test(o.id))
  const pool = text.length ? text : options
  // 1) explicit editorial promotion (prefer a servable one) — auto-tracks zen6…
  const promoted = pool.find((o) => o.featured && o.available) ?? pool.find((o) => o.featured)
  if (promoted) return promoted.id
  // 2) the Zen flagship by name (prefer a servable one)
  const zen = pool.filter(isZen)
  const flagship = flagshipZen(zen.filter((o) => o.available)) ?? flagshipZen(zen)
  if (flagship) return flagship.id
  // 3) any servable text model, else the first catalog entry
  return (pool.find((o) => o.available) ?? pool[0] ?? options[0]).id
}
