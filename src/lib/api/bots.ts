/**
 * Bots — the console client over the cloud POST /v1/bots/run surface
 * (cloud `clients/bots`: launch a computer-using bot on Hanzo compute — GATED +
 * METERED a flat per-run "bot" fee through the commerce ledger — returning the VNC
 * session URL the console embeds to watch/attach). Every launch is org-scoped
 * SERVER-SIDE from the minted user bearer; no credential reaches the browser.
 *
 * TRANSPORT: `cloudProxyV1Url('bots/run')` → `<origin>/v1/bots/run`, the console's
 * hardened `/v1` user-bearer proxy (NOT bare `/v1/…`, which the live ingress routes
 * to the gateway with no principal → 403 — the affiliates/referrals lesson).
 *
 * SCOPE: the cloud bots surface is launch-only BY DESIGN — it does not track a run's
 * runtime (visor + the bot-gateway own that). So there is no list/stop here yet;
 * when `GET /v1/bots` + a stop endpoint land (proxying the bot-gateway's live nodes),
 * add `list()`/`stop()` below — the transport is identical.
 */
import { restPost, cloudProxyV1Url } from './client'

const BASE = 'bots'

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** The surface a launched bot boots into. */
export type BotSurface = 'desktop' | 'terminal'

/** POST /v1/bots/run input — the launch request (mirrors cloud `runReq`). */
export interface BotRunInput {
  task: string
  surface: BotSurface
  gpu?: boolean
  timeout?: string // optional wall-clock, e.g. "30m"
}

/** POST /v1/bots/run result — the run id, status, and the VNC session to attach. */
export interface BotRun {
  runId: string
  status: string
  sessionUrl: string
}

/** Defensive normalizer over the bare-JSON `{runId,status,sessionUrl}` response. */
export function normalizeRun(v: unknown): BotRun {
  const r = asRecord(v)
  return { runId: str(r.runId), status: str(r.status), sessionUrl: str(r.sessionUrl) }
}

export const BotsApi = {
  /** POST /v1/bots/run — launch a computer-using bot (billed a flat per-run fee); returns its VNC session. */
  run: (input: BotRunInput): Promise<BotRun> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/run`), {
      task: input.task,
      surface: input.surface,
      gpu: input.gpu ?? false,
      timeout: input.timeout ?? '',
    }).then(normalizeRun),
}
