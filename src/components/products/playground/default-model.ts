/**
 * default-model — the pure policy for the playground's initial model pick, kept
 * separate from the effectful React catalog hook (`useModels`) so it has ONE home
 * and is unit-testable in plain Node.
 *
 * The default is our latest NON-PREMIUM Zen flagship, ready-to-Run:
 *   0) a $5 welcome-trial balance can only serve NON-PREMIUM models (the gateway
 *      402s a premium model for a trial-only balance), so the auto-default is chosen
 *      from the non-premium pool — a cold, trial-funded user gets a 200 on first Run;
 *   1) honor an explicit catalog promotion (`featured`) among the non-premium pool —
 *      so the pick auto-tracks whatever non-premium flagship we promote next;
 *   2) else the Zen flagship by name — the newest major, preferring a general-purpose
 *      tier (`zen5-flash`) over a specialized one (`zen5-coder`);
 *   3) else any servable non-premium text model, then the first catalog entry.
 * Auxiliary (embedding/audio/image) models are skipped for the chat default. The
 * non-premium filter falls back to the full pool ONLY when every model is premium
 * (an honest last resort — a pick beats an empty selector).
 */
import type { ModelOption } from './useModels'

/** Non-chat modalities skipped for the chat default. */
const AUX = /(embed|tts|whisper|speech|rerank|image|diffusion|flux|dall|guard|moderation)/i
/** Smaller/specialized tiers we never auto-default to over the bare flagship. */
const SUB_TIER = /(mini|flash|nano|lite|air|coder|instruct|embed|tts|whisper|speech|rerank|image|vision|guard)/i
/** Task-specialized variants — a general-purpose tier is preferred over these as the
 *  chat default (so `zen5-flash` wins over `zen5-coder` when both are non-premium). */
const SPECIALIZED = /(coder|instruct|embed|tts|whisper|speech|rerank|image|vision|guard|audio|reason|math)/i

/** A first-party Zen model (by id or provider). */
const isZen = (o: ModelOption): boolean => /zen/i.test(o.id) || o.provider.toLowerCase() === 'zen'

/**
 * Rank Zen models so the flagship wins: newest major first (so a future `zen6`
 * auto-outranks `zen5`), then the bare family id (`zen5`) over a named tier
 * (`zen5-pro`) over a smaller/specialized tier (`zen5-flash`/`-coder`), and finally
 * a general-purpose variant over a task-specialized one (`zen5-flash` > `zen5-coder`).
 */
function flagshipZen(zen: ModelOption[]): ModelOption | undefined {
  if (zen.length === 0) return undefined
  const score = (o: ModelOption): number => {
    const id = o.id.toLowerCase()
    const major = Number(id.match(/zen[-_]?(\d+)/)?.[1] ?? 0)
    const tier = SUB_TIER.test(id) ? 0 : /zen[-_]?\d+[-_.]/.test(id) ? 1 : 2 // sub < named < bare
    const generalist = SPECIALIZED.test(id) ? 0 : 1 // flash > coder within a tier
    return major * 100 + tier * 10 + generalist
  }
  return [...zen].sort((a, b) => score(b) - score(a))[0]
}

/**
 * The playground's default model id — the latest promoted NON-PREMIUM Zen flagship
 * (see the module docstring). Returns '' only for an empty catalog.
 */
export function defaultModelId(options: ModelOption[]): string {
  if (options.length === 0) return ''
  const text = options.filter((o) => !AUX.test(o.id))
  const base = text.length ? text : options
  // 0) prefer NON-PREMIUM so a $5 trial-only balance gets a 200 (a premium default
  //    would 402 on the very first Run). Fall back to the full pool only if EVERY
  //    model is premium — an honest pick beats an empty selector.
  const nonPremium = base.filter((o) => !o.premium)
  const pool = nonPremium.length ? nonPremium : base
  // 1) explicit editorial promotion (prefer a servable one) among the non-premium pool
  const promoted = pool.find((o) => o.featured && o.available) ?? pool.find((o) => o.featured)
  if (promoted) return promoted.id
  // 2) the Zen flagship by name (prefer a servable one)
  const zen = pool.filter(isZen)
  const flagship = flagshipZen(zen.filter((o) => o.available)) ?? flagshipZen(zen)
  if (flagship) return flagship.id
  // 3) any servable text model, else the first catalog entry
  return (pool.find((o) => o.available) ?? pool[0] ?? options[0]).id
}
