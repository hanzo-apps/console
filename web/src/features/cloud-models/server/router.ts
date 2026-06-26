import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { cloudGet, cloudPost } from "./cloudModelClient";
import {
  CloudModelsResponseSchema,
  UpdateModelConfigInput,
  type CloudModel,
  type CloudModelsResponse,
  type ModelConfig,
  type ModelPricing,
} from "../types";
import { env } from "@/src/env.mjs";

// The pricing service is the canonical, in-cluster model catalog: it lists
// every routable model with its per-token cost. It is the source of truth for
// the Models page (reachable with no auth), enriched by the Cloud API when that
// is configured. `/v1` surface, never `/api/*`.
const PRICING_API_URL =
  process.env.PRICING_API_URL ?? "http://pricing.hanzo.svc:8080";

type PricingModel = {
  id: string;
  owned_by?: string;
  provider?: string;
  premium?: boolean;
  pricing?: {
    input_cost_per_token?: number;
    output_cost_per_token?: number;
    input_cost_per_mtok?: number;
    output_cost_per_mtok?: number;
  };
};

function mapPricing(p: PricingModel["pricing"]): ModelPricing | null {
  if (!p) return null;
  return {
    inputCostPerToken: p.input_cost_per_token,
    outputCostPerToken: p.output_cost_per_token,
    inputCostPerMTok: p.input_cost_per_mtok,
    outputCostPerMTok: p.output_cost_per_mtok,
  };
}

/** Best-effort owner: explicit field, else the `owner/model` prefix, else a
 * heuristic from the model family. Grouping falls back to the raw string. */
function deriveOwner(m: PricingModel): string {
  if (m.owned_by) return m.owned_by;
  if (m.provider) return m.provider;
  if (m.id.includes("/")) return m.id.split("/")[0]!;
  const id = m.id.toLowerCase();
  if (/(^|[^a-z])(gpt|o1|o3|davinci|text-embedding)/.test(id))
    return "openai-direct";
  if (id.includes("claude")) return "anthropic";
  if (id.includes("gemini")) return "google";
  if (id.includes("llama")) return "fireworks";
  if (id.includes("zen") || id.includes("hanzo")) return "hanzo";
  return "hanzo";
}

/** Fetch the priced model catalog (best-effort: empty list on any failure). */
async function fetchPricingModels(): Promise<PricingModel[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${PRICING_API_URL}/v1/pricing/models`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: PricingModel[] };
    return data.models ?? [];
  } catch {
    return [];
  }
}

/** Optional enrichment from the Cloud API's own model list, when configured. */
async function fetchCloudModels(): Promise<CloudModel[]> {
  if (!env.CLOUD_API_URL) return [];
  try {
    const raw = await cloudGet<CloudModelsResponse>({ path: "/v1/models" });
    const parsed = CloudModelsResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data.data : [];
  } catch {
    return [];
  }
}

export const cloudModelsRouter = createTRPCRouter({
  // ── List available models (pricing catalog + cloud enrichment) ────────

  list: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async () => {
      const [pricingModels, cloudModels] = await Promise.all([
        fetchPricingModels(),
        fetchCloudModels(),
      ]);

      // Pricing is the catalog source of truth; index cloud models by id to lift
      // their `premium`/`owned_by` over the heuristic when both are present.
      const cloudById = new Map(cloudModels.map((m) => [m.id, m]));
      const data: Array<CloudModel & { pricing: ModelPricing | null }> = [];
      const seen = new Set<string>();

      for (const pm of pricingModels) {
        if (seen.has(pm.id)) continue;
        seen.add(pm.id);
        const cloud = cloudById.get(pm.id);
        data.push({
          id: pm.id,
          object: "model",
          created: 0,
          owned_by: cloud?.owned_by ?? deriveOwner(pm),
          premium: cloud?.premium ?? pm.premium ?? false,
          pricing: mapPricing(pm.pricing),
        });
      }
      // Include any cloud-only models the pricing catalog doesn't carry.
      for (const cm of cloudModels) {
        if (seen.has(cm.id)) continue;
        seen.add(cm.id);
        data.push({ ...cm, pricing: null });
      }

      return { object: "list" as const, data };
    }),

  // ── Get project model configuration ─────────────────────────────────

  getConfig: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      try {
        return await cloudGet<ModelConfig>({
          path: "/v1/model-config",
          queryParams: { projectId: input.projectId },
        });
      } catch {
        return {
          projectId: input.projectId,
          defaultModel: "zen4",
          temperature: 0.7,
          maxTokens: 4096,
        } satisfies ModelConfig;
      }
    }),

  // ── Update project model configuration ──────────────────────────────

  updateConfig: protectedProjectProcedure
    .input(UpdateModelConfigInput)
    .mutation(async ({ input }) => {
      try {
        return await cloudPost<ModelConfig>({
          path: "/v1/model-config",
          body: {
            projectId: input.projectId,
            defaultModel: input.defaultModel,
            temperature: input.temperature,
            maxTokens: input.maxTokens,
          },
        });
      } catch {
        return {
          projectId: input.projectId,
          defaultModel: input.defaultModel,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
        } satisfies ModelConfig;
      }
    }),
});
