import { LLMAdapter } from "@hanzo/console/src/server";
import { Hanzo } from "@hanzo/console-js";
import { env } from "@/src/env.mjs";
import { type FilterCondition, singleFilter } from "@hanzo/console";
import { z } from "zod/v4";

let hanzoClient: Hanzo | null = null;

/**
 * The model used to extract filters from a natural-language query. The
 * completion is routed through the Hanzo meter (OpenAI-compatible surface), so
 * `adapter` is OpenAI — `fetchLLMCompletion` selects its transport from
 * `modelParams.adapter`, and the meter then proxies to the real provider while
 * metering the call to the user's org. The model id is whatever the meter
 * serves; defaults to the legacy Bedrock model for continuity.
 */
export function getDefaultModelParams() {
  return {
    provider: "openai",
    adapter: LLMAdapter.OpenAI,
    model: env.HANZO_NL_FILTER_MODEL ?? env.HANZO_AWS_BEDROCK_MODEL ?? "",
    temperature: 0.1,
    maxTokens: 1000,
    topP: 0.9,
  };
}

const FilterArraySchema = z.array(singleFilter);

export function parseFiltersFromCompletion(
  completion: string,
): FilterCondition[] {
  const arrayMatch = completion.match(/\[[\s\S]*?\]/)?.[0];
  const objectMatch = completion.match(/\{[\s\S]*?\}/)?.[0];

  const candidates = [
    completion, // full response
    arrayMatch, // extract JSON array
    objectMatch ? `[${objectMatch}]` : undefined, // wrap single object in array
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      // sometimes, ai returns {filters: [...]}, extract the filters array
      const filtersArray = parsed.filters || parsed;
      const validated = FilterArraySchema.parse(filtersArray);
      return validated;
    } catch {
      // try next candidate
    }
  }
  return [];
}

export function getHanzoClient(
  publicKey: string,
  secretKey: string,
  baseUrl?: string,
  enabled?: boolean,
): Hanzo {
  if (!hanzoClient) {
    hanzoClient = new Hanzo({
      publicKey,
      secretKey,
      baseUrl,
      enabled: enabled ?? true,
    });
  }
  return hanzoClient;
}
