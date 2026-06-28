/**
 * Hanzo single-meter connection — the ONE way a console server surface routes an
 * LLM call through the Hanzo meter (`api.hanzo.ai`, the OpenAI-compatible
 * gateway) ON THE SIGNED-IN USER'S per-user `hk-` Cloud API key, so the request
 * is metered + billed to THAT user's org.
 *
 * This is the generic primitive shared by every metered surface (Playground,
 * natural-language filters, …): resolve-or-mint the user's `hk-` key, and build
 * a synthetic, schema-valid `llmConnection` that points `fetchLLMCompletion` at
 * the meter. Surfaces that ALSO honor a tenant's BYO key layer that decision on
 * top; this module owns only the meter leg.
 *
 * FAIL-CLOSED: when the user's `hk-` key can neither be resolved nor minted we
 * throw — we NEVER silently fall back to an unmetered or shared path.
 *
 * Server-only. Never import into a client bundle.
 */
import { env } from "@/src/env.mjs";
import { iamGetUser, iamMintUserKeys } from "@/src/features/auth/lib/iamServer";
import { encrypt } from "@hanzo/console/encryption";
import {
  LLMAdapter,
  LLMApiKeySchema,
} from "@hanzo/console/src/server/llm/types";

/** The parsed connection shape `fetchLLMCompletion` consumes. */
export type LlmConnection = ReturnType<typeof LLMApiKeySchema.parse>;

/**
 * The Hanzo single meter on its canonical `/v1` surface (never `/api/*`). Live
 * console has no `CLOUD_API_URL` set, so default to the public meter
 * (`https://api.hanzo.ai`); an explicit `CLOUD_API_URL` (e.g. in-cluster DNS)
 * overrides it.
 */
export function meterBaseUrl(): string {
  const base = (env.CLOUD_API_URL ?? "https://api.hanzo.ai").replace(
    /\/+$/,
    "",
  );
  return `${base}/v1`;
}

/**
 * Resolve the signed-in user's per-user `hk-` Cloud API key, minting one if the
 * IAM user has none. FAIL-CLOSED: throws when there is no IAM identity, or when
 * the key can neither be resolved nor minted — the caller must NOT fall back to
 * an unmetered path. `iamSub` MUST be the authenticated session user's own sub
 * (never client-supplied input).
 */
export async function resolveUserHkKey(
  iamSub: string | undefined,
): Promise<string> {
  if (!iamSub) {
    throw new Error(
      "No IAM identity on session; cannot resolve a metered Cloud API key.",
    );
  }

  const existing = await iamGetUser(iamSub);
  if (existing?.accessKey) return existing.accessKey;

  const minted = await iamMintUserKeys(iamSub);
  if (minted.ok && minted.accessKey) return minted.accessKey;

  throw new Error(
    `Could not resolve or mint a Hanzo Cloud API key for the signed-in user (${iamSub}); refusing to route the completion unmetered.`,
  );
}

/**
 * Build a synthetic, schema-valid `llmConnection` that points
 * `fetchLLMCompletion` at the Hanzo meter on the user's `hk-` key. The
 * `secretKey` is ENCRYPTED because `fetchLLMCompletion` decrypts
 * `llmConnection.secretKey` before use — the same contract as a stored BYO key.
 *
 * NOTE: `fetchLLMCompletion` selects its transport from `modelParams.adapter`,
 * so the caller MUST set `modelParams.adapter = LLMAdapter.OpenAI` for the call
 * to actually traverse the meter's OpenAI-compatible surface at `baseURL`.
 */
export function buildMeterConnection(params: {
  hkKey: string;
  provider: string;
  projectId: string;
}): LlmConnection {
  const { hkKey, provider, projectId } = params;
  return LLMApiKeySchema.parse({
    id: `hanzo-meter:${projectId}:${provider}`,
    projectId,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    adapter: LLMAdapter.OpenAI,
    provider,
    displaySecretKey: "hk-...",
    secretKey: encrypt(hkKey),
    extraHeaders: null,
    extraHeaderKeys: [],
    baseURL: meterBaseUrl(),
    customModels: [],
    withDefaultModels: true,
    config: null,
  });
}
