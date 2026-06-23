import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "@/src/server/auth";
import { hasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { type ProjectScope } from "@/src/features/rbac/constants/projectAccessRights";
import {
  getZapScopeModule,
  scopePrefixOf,
  type ZapToolRequest,
} from "@/src/features/zap/server/registry";
// Side effect: register all ZAP scopes (zt + migrated domains).
import "@/src/features/zap/server/register";

/**
 * Generic ZAP tool endpoint — the one route every migrated domain shares.
 *
 *   POST /v1/zap/<scope>   { name: "<scope>.<method>", args: { projectId, ... } }
 *   → { content: T }
 *
 * Auth (IAM session) + RBAC (the tool's required ProjectScope) + project-access
 * are enforced here, then the call is dispatched to the scope's registered
 * ZAP module. Adding a domain to ZAP never touches this file. The dedicated
 * `/v1/zap/zt` route still serves `zt` (Pages-Router specificity wins); this
 * handles every other scope.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerAuthSession({ req, res });
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body as { name?: string; args?: Record<string, unknown> };
  if (!body.name || typeof body.name !== "string") {
    return res.status(400).json({ error: "Missing or invalid tool name" });
  }
  const name = body.name;
  const args = body.args ?? {};
  const prefix = scopePrefixOf(name);

  const mod = getZapScopeModule(prefix);
  if (!mod) {
    return res.status(404).json({ error: `Unknown ZAP scope: ${prefix}` });
  }

  const rbacScope = mod.getToolScope(name);
  if (!rbacScope) {
    return res.status(404).json({ error: `Unknown ZAP tool: ${name}` });
  }

  const projectId =
    typeof args.projectId === "string" ? args.projectId : undefined;
  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId in args" });
  }

  if (
    !hasProjectAccess({
      session,
      projectId,
      scope: rbacScope as ProjectScope,
    })
  ) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const result = await mod.callTool({ name, args } as ZapToolRequest);
    return res.status(200).json(result);
  } catch (err) {
    const status =
      typeof (err as { status?: unknown })?.status === "number"
        ? (err as { status: number }).status
        : 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    if (status >= 500) console.error(`[zap/${prefix}]`, message);
    return res.status(status).json({ error: message });
  }
}
