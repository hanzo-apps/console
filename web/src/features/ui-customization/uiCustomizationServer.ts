/**
 * UiCustomization — ZAP capability-RPC server (replaces uiCustomizationRouter).
 *
 * This is the per-router migration unit: a class implementing the generated
 * `UiCustomization$Server$Target`. Each method gates on the caller's capability
 * via the single chokepoint `requirePermission`, then runs the exact same logic
 * the tRPC procedure ran (here: env + the server-side self-host plan helper — no
 * Prisma is touched because the original `get` read env, not the DB).
 *
 * The factory takes the {@link ZapContext} (verified cap + backend handles) so the
 * capability check is per-call, not ambient. zap-es's Server.impl calls receive
 * (params, results) ZAP structs; we write results in place.
 */
import { env } from "@/src/env.mjs";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { getSelfHostedInstancePlanServerSide } from "@/src/features/entitlements/server/getPlan";
import { getVisibleProductModules } from "@/src/features/ui-customization/productModuleSchema";
import {
  Perm,
  requirePermission,
  type ZapContext,
} from "@/src/server/zap/context";
import {
  UiCustomization$Server,
  type UiCustomization$Server$Target,
  type UiCustomization_Get$Params,
  type UiCustomization_Get$Results,
  type UiCustomization_GetModules$Params,
  type UiCustomization_GetModules$Results,
} from "@/src/server/zap/gen/ui-customization";

/** Compute the visible product modules from env (shared by both methods). */
function visibleModules(): string[] {
  return getVisibleProductModules(
    env.HANZO_UI_VISIBLE_PRODUCT_MODULES,
    env.HANZO_UI_HIDDEN_PRODUCT_MODULES,
  );
}

/** True iff this self-hosted instance's plan entitles UI customization. */
function isEntitled(): boolean {
  return hasEntitlementBasedOnPlan({
    plan: getSelfHostedInstancePlanServerSide(),
    entitlement: "self-host-ui-customization",
  });
}

/** The target whose methods zap-es dispatches to. One method per tRPC procedure. */
class UiCustomizationTarget implements UiCustomization$Server$Target {
  constructor(private readonly ctx: ZapContext) {}

  /** Was: uiCustomizationRouter.get (protectedProcedure.query). */
  async get(
    _params: UiCustomization_Get$Params,
    results: UiCustomization_Get$Results,
  ): Promise<void> {
    requirePermission(this.ctx, Perm.SessionRead);

    const config = results._initConfig();
    if (!isEntitled()) {
      // tRPC returned `null` when not entitled; the wire models that as present=false.
      config.present = false;
      return;
    }

    config.present = true;
    config.hostname = env.HANZO_UI_API_HOST ?? "";
    config.documentationHref = env.HANZO_UI_DOCUMENTATION_HREF ?? "";
    config.supportHref = env.HANZO_UI_SUPPORT_HREF ?? "";
    config.feedbackHref = env.HANZO_UI_FEEDBACK_HREF ?? "";
    config.logoLightModeHref = env.HANZO_UI_LOGO_LIGHT_MODE_HREF ?? "";
    config.logoDarkModeHref = env.HANZO_UI_LOGO_DARK_MODE_HREF ?? "";
    config.defaultModelAdapter = env.HANZO_UI_DEFAULT_MODEL_ADAPTER ?? "";
    config.defaultBaseUrlOpenAI = env.HANZO_UI_DEFAULT_BASE_URL_OPENAI ?? "";
    config.defaultBaseUrlAnthropic =
      env.HANZO_UI_DEFAULT_BASE_URL_ANTHROPIC ?? "";
    config.defaultBaseUrlAzure = env.HANZO_UI_DEFAULT_BASE_URL_AZURE ?? "";

    const modules = visibleModules();
    const list = config._initVisibleModules(modules.length);
    modules.forEach((m, i) => list.set(i, m));
  }

  /** New: just the visible module list — a distinct, pipeline-able read. */
  async getModules(
    _params: UiCustomization_GetModules$Params,
    results: UiCustomization_GetModules$Results,
  ): Promise<void> {
    requirePermission(this.ctx, Perm.SessionRead);

    const modules = visibleModules();
    const result = results._initResult();
    const list = result._initModules(modules.length);
    modules.forEach((m, i) => list.set(i, m));
  }
}

/** Build the UiCustomization ZAP server bound to a request's capability context. */
export function uiCustomizationServer(ctx: ZapContext): UiCustomization$Server {
  return new UiCustomization$Server(new UiCustomizationTarget(ctx));
}
