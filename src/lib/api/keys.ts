/**
 * Cloud API key client — the per-user `sk-` credential.
 *
 * The address is `/v1/account/keys`, which is cloud's own. It used to be `/v1/iam/keys`,
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
 * The secret is returned ONLY by `create()` (show once). `status()` reports its
 * existence + public prefix, never secret material — and, separately, the account's
 * publishable keys in full, which is safe precisely because they authenticate nobody.
 */
import { originV1Url, restDelete, restGet, restPost } from './client'

/**
 * A PUBLISHABLE (`pk-`) key, listed in full.
 *
 * It resolves to the ORG and mints no principal, so it authenticates nobody and is
 * safe in a page's source — which is why cloud returns its whole value and this
 * console shows it. That is the opposite of the secret below, and the two must stay
 * visibly different: one is shown, the other is revealed once and then masked.
 */
export type PublishableKey = {
  /** The full `pk-…` value. */
  key: string
  /** Leading identifier (`pk-live-…`) — cloud's when it sends one, else derived. */
  prefix: string
  createdAt?: string
}

export type KeyStatus = {
  /**
   * A SECRET (`sk-`) key exists. Deliberately narrow: `sk-` resolves to the USER and
   * is session-equivalent, so the onboarding step and the dev dock both mean THIS
   * key. Holding publishable keys must never satisfy it.
   */
  hasKey: boolean
  keyPrefix: string
  /** When the key row last changed in IAM (mint/rotate), ISO; '' when unknown. */
  createdAt?: string
  /** Every publishable key on the account — a separate holding, never folded in above. */
  publishable: PublishableKey[]
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
 * of the list, which also carries the publishable `pk-` keys.
 */
const SECRET = 'secret'

const keysUrl = (): string => originV1Url('account/keys')

/** The rows cloud listed, whether it answered `{keys:[…]}` or a bare array. */
const rowsOf = (out: unknown): ApiKey[] => {
  if (Array.isArray(out)) return out as ApiKey[]
  const keys = (out as { keys?: unknown } | null)?.keys
  return Array.isArray(keys) ? (keys as ApiKey[]) : []
}

/**
 * Split the listing into the two shapes that exist.
 *
 * The read used to `find` the secret and drop the rest on the floor, so an account
 * holding three publishable keys and no secret was shown the "create your first key"
 * empty state — a true statement about `sk-` presented as the whole truth about the
 * account. Both holdings are reported now, still separately.
 */
export function partitionKeys(out: unknown): { secret?: ApiKey; publishable: PublishableKey[] } {
  const rows = rowsOf(out)
  return {
    secret: rows.find((k) => (k?.type ?? SECRET) === SECRET),
    publishable: rows
      .filter((k) => (k?.type ?? SECRET) !== SECRET)
      .map((k) => ({
        key: k.key ?? '',
        // Cloud sends an 11-char prefix; derive the same span when it does not, so a
        // row always names itself even if only the full value came back.
        prefix: k.prefix || (k.key ?? '').slice(0, 11),
        createdAt: k.createdAt,
      }))
      .filter((k) => k.key !== '' || k.prefix !== ''),
  }
}

export const KeysApi = {
  /** Whether the account has a secret key (plus its public prefix), and its publishable keys. */
  status: async (): Promise<KeyStatus> => {
    const out = await restGet<unknown>(keysUrl())
    const { secret, publishable } = partitionKeys(out)
    return {
      hasKey: Boolean(secret),
      keyPrefix: secret?.prefix ?? '',
      createdAt: secret?.createdAt ?? '',
      publishable,
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
