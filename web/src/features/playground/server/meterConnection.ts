/**
 * Playground LLM connection resolution — decides which `llmConnection`
 * `fetchLLMCompletion` runs on for a Playground chat completion:
 *
 *   - if the project has a BYO `llmApiKeys` row for the requested provider, use
 *     it unchanged (the tenant's own key, billed to the tenant — left exactly as
 *     it was), or
 *   - otherwise route through the Hanzo single meter (`api.hanzo.ai`, the
 *     OpenAI-compatible gateway) on the SIGNED-IN USER's per-user `hk-` Cloud API
 *     key, so the request is metered + billed to THAT user's org.
 *
 * Decomplected from the request handler (separation of concerns): the handler
 * owns HTTP/orchestration; this module owns the BYO-vs-meter decision, the
 * resolve-or-mint of the user's `hk-` key, and the synthetic meter connection.
 *
 * FAIL-CLOSED: when there is no BYO key and the user's `hk-` key can neither be
 * resolved nor minted, we throw — we NEVER silently fall back to an unmetered or
 * shared path.
 *
 * Server-only. Never import into a client bundle.
 */
import { env } from "@/src/env.mjs";
import { iamGetUser, iamMintUserKeys } from "@/src/features/auth/lib/iamServer";
import { prisma } from "@hanzo/console/src/db";
import { encrypt } from "@hanzo/console/encryption";
import {
  LLMAdapter,
  LLMApiKeySchema,
} from "@hanzo/console/src/server/llm/types";

/** The parsed connection shape `fetchLLMCompletion` consumes. */
export type LlmConnection = ReturnType<typeof LLMApiKeySchema.parse>;

/**
 * The Hanzo single meter base on its canonical `/v1` surface (never `/api/*`).
 * Live console has no `CLOUD_API_URL` set, so default to the public meter
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
      "No IAM identity on session; cannot resolve a metered Cloud API key for the Playground.",
    );
  }

  const existing = await iamGetUser(iamSub);
  if (existing?.accessKey) return existing.accessKey;

  const minted = await iamMintUserKeys(iamSub);
  if (minted.ok && minted.accessKey) return minted.accessKey;

  throw new Error(
    `Could not resolve or mint a Hanzo Cloud API key for the signed-in user (${iamSub}); refusing to route Playground completion unmetered.`,
  );
}

/**
 * Build a synthetic, schema-valid `llmConnection` that points `fetchLLMCompletion`
 * at the Hanzo meter on the user's `hk-` key. The `secretKey` is ENCRYPTED
 * because `fetchLLMCompletion` decrypts `llmConnection.secretKey` before use —
 * the same contract as a stored BYO key.
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

/**
 * Resolve the `llmConnection` for a Playground chat completion (the BYO-vs-meter
 * decision). When a BYO project key exists for `provider` it is used unchanged;
 * otherwise the request is routed through the Hanzo meter on the user's `hk-`
 * key (fail-closed on key resolution — see {@link resolveUserHkKey}).
 */
export async function resolvePlaygroundLlmConnection(params: {
  projectId: string;
  provider: string;
  iamSub: string | undefined;
}): Promise<LlmConnection> {
  const { projectId, provider, iamSub } = params;

  const byoKey = await prisma.llmApiKeys.findFirst({
    where: { projectId, provider },
  });

  if (byoKey) {
    const parsed = LLMApiKeySchema.safeParse(byoKey);
    if (!parsed.success) {
      throw new Error(
        `Could not parse API key for provider ${provider}: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  const hkKey = await resolveUserHkKey(iamSub);
  return buildMeterConnection({ hkKey, provider, projectId });
}
