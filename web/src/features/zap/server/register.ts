/**
 * ZAP scope registrations — the single place domains plug into the generic
 * `/v1/zap/[scope]` route. As the tRPC→ZAP strangler progresses, each migrated
 * domain adds one line here. Imported for side effect by the generic route.
 *
 * Server-only.
 */
import { registerZapScope } from "./registry";
import {
  getToolScope as ztGetToolScope,
  callTool as ztCallTool,
} from "@/src/features/zt/server/ztTools";

// zt — Zero Trust edge management. The proven ZAP feature; its tool module
// (getToolScope + callTool) is exactly the ZapScopeModule shape.
registerZapScope("zt", {
  getToolScope: ztGetToolScope,
  callTool: ztCallTool,
});

// Strangler frontier — migrated tRPC domains register their ZAP tools here:
// registerZapScope("prompts", promptsZapModule);
// registerZapScope("models", modelsZapModule);
