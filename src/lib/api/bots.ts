/**
 * Bots — the console client over the cloud `/v1/bot/runs` collection
 * (cloud `apps/bot`: launch a computer-using bot on Hanzo compute — GATED +
 * METERED a flat per-run "bot" fee through the commerce ledger — returning the VNC
 * session URL the console embeds to watch/attach). Every launch is org-scoped
 * SERVER-SIDE from the minted user bearer; no credential reaches the browser.
 *
 * TRANSPORT: `cloudProxyV1Url('bot/runs')` → `<origin>/v1/bot/runs`, the console's
 * hardened `/v1` user-bearer proxy (NOT bare `/v1/…`, which the live ingress routes
 * to the gateway with no principal → 403 — the affiliates/referrals lesson).
 *
 * SCOPE: one collection, three verbs (HIP-0139). `run` POSTs the launch; `list` GETs
 * the caller's org runs off the same `/v1/bot/runs` (proxying the bot-gateway's live
 * nodes); `stop` halts one off `POST /v1/bot/runs/:runId/stop`. All three ride the same
 * hardened `/v1` user-bearer proxy and defensively normalize their bare-JSON responses.
 */
import { restGet, restPost, cloudProxyV1Url } from './client'

const BASE = 'bot/runs'

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
/** Coerce a timestamp field, keeping a number as a number and stringifying anything else. */
const numOrStr = (v: unknown): number | string => (typeof v === 'number' ? v : str(v))

/** The surface a launched bot boots into. */
export type BotSurface = 'desktop' | 'terminal'

/** Coerce an unknown surface to the closed union — anything but `terminal` reads as `desktop`. */
const asSurface = (v: unknown): BotSurface => (str(v) === 'terminal' ? 'terminal' : 'desktop')

/** POST /v1/bot/runs input — the launch request (mirrors cloud `runReq`). */
export interface BotRunInput {
  task: string
  surface: BotSurface
  gpu?: boolean
  timeout?: string // optional wall-clock, e.g. "30m"
}

/** POST /v1/bot/runs result — the run id, status, and the VNC session to attach. */
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

/**
 * GET /v1/bot/runs row — a launched run enriched with the task/surface it ran and when it
 * started, so the console lists real org runs (not just this session's launches).
 */
export interface BotRunRow extends BotRun {
  task: string
  surface: BotSurface
  startedAt: number | string
}

/** Defensive normalizer over a `GET /v1/bot/runs` row (`{runId,task,surface,status,sessionUrl,startedAt}`). */
export function normalizeRunRow(v: unknown): BotRunRow {
  const r = asRecord(v)
  return {
    ...normalizeRun(r),
    task: str(r.task),
    surface: asSurface(r.surface),
    startedAt: numOrStr(r.startedAt),
  }
}

export const BotsApi = {
  /** POST /v1/bot/runs — launch a computer-using bot (billed a flat per-run fee); returns its VNC session. */
  run: (input: BotRunInput): Promise<BotRun> =>
    restPost<unknown>(cloudProxyV1Url(BASE), {
      task: input.task,
      surface: input.surface,
      gpu: input.gpu ?? false,
      timeout: input.timeout ?? '',
    }).then(normalizeRun),

  /** GET /v1/bot/runs — the caller's org runs (`{ bots: [...] }`), each defensively normalized. */
  list: (): Promise<BotRunRow[]> =>
    restGet<unknown>(cloudProxyV1Url(BASE)).then((v) => {
      const bots = asRecord(v).bots
      return Array.isArray(bots) ? bots.map(normalizeRunRow) : []
    }),

  /** POST /v1/bot/runs/:runId/stop — halt a run; returns its `{runId,status}`. */
  stop: (runId: string): Promise<BotRun> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/${encodeURIComponent(runId)}/stop`), {}).then(normalizeRun),
}
