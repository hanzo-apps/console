import { z } from "zod";

/**
 * All available product modules in Hanzo
 */
export const PRODUCT_MODULES = [
  "dashboards",
  "tracing",
  "evaluation",
  "prompt-management",
  "playground",
  "datasets",
  "search",
  "agents",
  "bots",
  "tasks",
  "functions",
  "kms",
  "infrastructure",
  "base",
  "cms",
  "zt",
  "referrals",
] as const;

/**
 * Product modules that ship enabled by default — the curated, non-overwhelming
 * set of coherent products. Everything else in PRODUCT_MODULES is hidden until
 * explicitly turned on (ad-hoc enableable), either via the per-org UI
 * customization (enterprise) or the HANZO_UI_VISIBLE_PRODUCT_MODULES env on a
 * self-host deployment.
 *
 * This is the ONE place that decides the default product surface. To launch a
 * product, add its module here; to hide one, remove it. Nav grouping
 * (RouteGroup) gives each product its own labeled section with its sub-pages.
 *
 * Kept intentionally tight: the core LLM-observability + ops products plus the
 * Search/AI product. Agents, Bots, Tasks, Functions, KMS, Infrastructure, Base,
 * Zero Trust and Referrals are gated off by default — they light up the moment
 * they're added here or enabled per-org.
 */
export const DEFAULT_ENABLED_MODULES = [
  "dashboards",
  "tracing",
  "evaluation",
  "prompt-management",
  "playground",
  "datasets",
  "search",
] as const satisfies readonly (typeof PRODUCT_MODULES)[number][];

/**
 * Schema for product modules that can be enabled/disabled in the UI
 */
export const ProductModule = z.enum(PRODUCT_MODULES);

/**
 * Type for product modules that can be enabled/disabled in the UI
 */
export type ProductModule = z.infer<typeof ProductModule>;

/**
 * Parse environment variables to determine which product modules should be visible.
 *
 * Two configuration modes:
 * - When HANZO_UI_VISIBLE_PRODUCT_MODULES is set: only listed modules are visible
 * - When HANZO_UI_HIDDEN_PRODUCT_MODULES is set: all modules except listed ones are visible
 *
 * If both are set, HANZO_UI_VISIBLE_PRODUCT_MODULES takes precedence.
 * If neither is set, all modules are visible.
 */
export function getVisibleProductModules(
  visibleModulesEnv?: string,
  hiddenModulesEnv?: string,
): ProductModule[] {
  // If both variables are set, visible list takes precedence with a warning
  if (visibleModulesEnv && hiddenModulesEnv) {
    console.warn(
      "Both HANZO_UI_VISIBLE_PRODUCT_MODULES and HANZO_UI_HIDDEN_PRODUCT_MODULES are set. " +
        "Using HANZO_UI_VISIBLE_PRODUCT_MODULES as the allow list.",
    );
    return parseModulesList(visibleModulesEnv);
  }

  // Only hidden list set - return all modules except hidden ones
  if (hiddenModulesEnv) {
    const hiddenModules = parseModulesList(hiddenModulesEnv);
    return PRODUCT_MODULES.filter(
      (module) => !hiddenModules.includes(module as ProductModule),
    ) as ProductModule[];
  }

  // Only visible list set - return only the visible modules
  if (visibleModulesEnv) {
    return parseModulesList(visibleModulesEnv);
  }

  // Neither is set - all modules are visible
  return [...PRODUCT_MODULES] as ProductModule[];
}

/**
 * Parse comma-separated values into product modules array.
 * Invalid values are filtered out.
 */
function parseModulesList(input: string): ProductModule[] {
  if (!input || !input.trim()) return [];

  return input
    .toLowerCase()
    .split(",")
    .map((module) => module.trim())
    .filter(Boolean)
    .filter((module) =>
      PRODUCT_MODULES.includes(module as ProductModule),
    ) as ProductModule[];
}
