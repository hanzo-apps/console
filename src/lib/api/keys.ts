/**
 * Cloud API key client — the per-user `sk-` credential.
 *
 * The address is `/v1/keys`, which is cloud's own. It used to be `/v1/iam/keys`,
 * and that is the whole of this bug: `api.hanzo.ai` routes `/v1/iam/*` to IAM, so
 * a request to the old address never reached cloud at all — IAM answered it, saw
 * no bearer of its own, and returned its own 401. The console told a signed-in
 * person to create a key on a card whose read had been refused by a service that
 * was never meant to serve it. Cloud moved the surface off IAM's prefix for
 * exactly this reason (clients/account: "the same rule that moved the key surface
 * off /v1/iam/keys"); this follows it.
 *
 * One transport, the same one every other cloud call uses: `restGet`/`restPost`/
 * `restDelete` over the shared fetch, which carries the caller's identity —
 * a minted user Bearer where a BFF stands in front, the first-party session
 * cookie where the console is served by cloud itself. The old code hand-rolled a
 * bare `fetch` with `Accept` and nothing else, so it presented no identity at all.
 *
 * The secret is returned ONLY by `create()` (show once). `status()` reports
 * existence + the public prefix, never secret material.
 */
import { originV1Url, restDelete, restGet, restPost } from './client'

export type KeyStatus = {
  hasKey: boolean
  keyPrefix: string
  /** When the key row last changed in IAM (mint/rotate), ISO; '' when unknown. */
  createdAt?: string
}

/** One key as cloud lists it. `key` is present for a publishable key only. */
type ApiKey = {
  type?: string
  prefix?: string
  key?: string
  createdAt?: string
}

/**
 * The SECRET key — the `sk-` credential this page manages. Cloud reads an omitted
 * `type` as this one, so neither write sends a body; the read has to pick it out
 * of the list, which also carries the publishable `pk-` key.
 */
const SECRET = 'secret'

const keysUrl = (): string => originV1Url('keys')

/** The secret key's row, or undefined when the caller holds none. */
const secretOf = (keys: unknown): ApiKey | undefined =>
  (Array.isArray(keys) ? (keys as ApiKey[]) : []).find(
    (k) => (k?.type ?? SECRET) === SECRET,
  )

export const KeysApi = {
  /** Whether the account has a key, plus its public prefix (no secret). */
  status: async (): Promise<KeyStatus> => {
    const out = await restGet<{ keys?: ApiKey[] }>(keysUrl())
    const row = secretOf(out?.keys)
    return {
      hasKey: Boolean(row),
      keyPrefix: row?.prefix ?? '',
      createdAt: row?.createdAt ?? '',
    }
  },
  /** Mint (or rotate) the key; returns the full `sk-` key ONCE. */
  create: async (): Promise<{ accessKey: string }> => {
    const out = await restPost<{ accessKey?: string; key?: string }>(keysUrl())
    // The mint answers with both spellings; either is the one-time reveal.
    return { accessKey: out?.accessKey ?? out?.key ?? '' }
  },
  /** Revoke the key (the old key stops working). */
  revoke: async (): Promise<{ ok: boolean }> => {
    // restDelete resolves only on a 2xx — a refusal throws — so reaching here IS
    // the confirmation, and there is no body to read one out of.
    await restDelete(keysUrl())
    return { ok: true }
  },
}
