/**
 * console2 ZAP-native transport — the drop-in replacement for the REST
 * `lib/api/client.ts`, built on `@zap-proto/web` (the published
 * "drop-in tRPC replacement"). One shared ZAP-over-WebSocket connection;
 * `zapCall(method, input)` ships a SuperJSON payload and resolves the decoded
 * result — binary ZAP on the wire, never JSON-over-HTTP.
 *
 * PATTERN PRECEDENT: this mirrors, near line-for-line, the production transport
 * in `hanzoai/sign` (`packages/trpc/zap/client/index.ts`), which already runs
 * the eSign app's entire data layer over ZAP instead of tRPC. The only
 * difference: console2 routes on a `method` string against the Go casibase
 * backend (`hanzoai/cloud`) rather than sign's generated per-router methods.
 *
 * ── LIVE STATUS (honest) ───────────────────────────────────────────────────
 * This client is COMPLETE and TYPE-CHECKS, but there is NOT YET a live
 * browser-reachable ZAP endpoint to call. Verified 2026-06-25:
 *   • `wss://cloud.hanzo.ai/zap` returns the Next.js SPA HTML (catch-all), not a
 *     WS upgrade — no `/zap` face is served at the edge.
 *   • `hanzoai/cloud` declares `ZAPListenAddr` (`:9653`, CLOUD_ZAP_LISTEN) in
 *     config.go and logs it in serve.go, but serve.go only calls
 *     `app.Listen(cfg.ListenAddr)` (HTTP) — the ZAP listener is scaffolded,
 *     never bound.
 * THE ONE BACKEND STEP to make this live: have cloud `serve.go` stand up a
 * `@zap-proto/web`-compatible ZAP/WS server (the `serve(httpServer, { path:
 * '/zap', mintCap, rootCap })` shape) — OR bind the Go `luxfi/zap` server on
 * `ZAPListenAddr` and route `/zap` to it at the edge. The browser bearer rides
 * the session cookie on the WS upgrade (mintCap reads it), exactly as the REST
 * client uses `credentials: 'include'` today.
 */
import SuperJSON from 'superjson'

import { connect, type Connection } from '@zap-proto/web/client'
import type { Conn } from '@zap-proto/web'

import { config } from '~/config'
import { ApiError } from '~/lib/api/client'
import { METHOD_RPC, ZapReply, newZapRequest } from './transport'

/** WS upgrade path on the cloud backend (matches sign's ZAP_PATH). */
export const ZAP_PATH = '/zap'

/** Build the `wss://` (or `ws://`) ZAP URL from the configured cloud origin. */
export function zapUrl(): string {
  const url = new URL(config.cloudUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = ZAP_PATH
  return url.toString()
}

let shared: Promise<Connection<Conn>> | null = null

/** Open (or reuse) the one shared ZAP connection. */
function getConnection(): Promise<Connection<Conn>> {
  if (!shared) {
    shared = connect<Conn>(zapUrl()).catch((err) => {
      shared = null
      throw err
    })
  }
  return shared
}

/**
 * Call a `/v1` route over ZAP. `method` is the endpoint name (e.g.
 * `"get-global-providers"`); `input` is SuperJSON-encoded. Resolves the decoded
 * result, or throws a typed `ApiError` carrying the wire status (so callers and
 * the existing `AuthGate` 401/403 handling are unchanged from the REST client).
 */
export async function zapCall<T = unknown>(method: string, input?: unknown): Promise<T> {
  const conn = await getConnection()

  const payload = newZapRequest({
    method,
    payload: input === undefined ? '' : SuperJSON.stringify(input),
  })

  const resp = await conn.bootstrap.call(METHOD_RPC, { payload })
  const reply = ZapReply.wrap(resp.body)

  if (!reply.ok) {
    let msg = `ZAP request failed (status ${reply.status})`
    if (reply.errorJson) {
      try {
        const parsed = JSON.parse(reply.errorJson) as { msg?: string; message?: string }
        msg = parsed.msg ?? parsed.message ?? msg
      } catch {
        /* keep default */
      }
    }
    throw new ApiError(msg, reply.status)
  }

  return (reply.result === '' ? undefined : SuperJSON.parse(reply.result)) as T
}

/** Close the shared connection (e.g. on sign-out). */
export async function closeZap(): Promise<void> {
  if (!shared) return
  const conn = await shared.catch(() => null)
  shared = null
  conn?.close()
}
