import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/src/env.mjs";
import { getServerAuthSession } from "@/src/server/auth";
import {
  requestedProjectId,
  resolveTenantScope,
} from "@/src/server/tenant-scope";

export type ProxyTenantHeaders = {
  "x-org-id"?: string;
  "x-project-id"?: string;
  "x-tenant-id"?: string;
  "x-actor-id"?: string;
  "x-env"?: string;
};

function firstTruthy(
  values: Array<string | undefined | null>,
): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function getHeaderValue(req: NextApiRequest, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (Array.isArray(value)) {
    const joined = value.join(",").trim();
    return joined || undefined;
  }
  return undefined;
}

export async function buildProxyTenantHeaders(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<ProxyTenantHeaders> {
  // Start with empty headers. DO NOT seed from client-supplied request headers
  // (x-org-id, x-project-id, x-tenant-id) -- those are untrusted and could
  // cause cross-tenant access on downstream services if forwarded unvalidated.
  const result: ProxyTenantHeaders = {
    "x-env":
      getHeaderValue(req, "x-env") ??
      firstTruthy([env.NEXT_PUBLIC_HANZO_CLOUD_REGION]),
  };

  try {
    const session = await getServerAuthSession({ req, res });
    // Resolve the tenant from the project the embed iframe declares, AUTHORIZED
    // against the session (pure logic in tenant-scope). Never falls back to an
    // arbitrary org, so we never leak another tenant's headers.
    const declaredProjectId = requestedProjectId({
      query: req.query,
      referer: req.headers.referer ?? req.headers.referrer,
    });
    const { orgId, projectId, actorId } = resolveTenantScope(
      session,
      declaredProjectId,
    );
    if (orgId) {
      result["x-org-id"] = orgId;
      result["x-tenant-id"] = orgId;
    }
    if (projectId) {
      result["x-project-id"] = projectId;
    }
    if (actorId) {
      result["x-actor-id"] = actorId;
    }
    return result;
  } catch {
    return result;
  }
}

export function applyProxyTenantHeaders(
  headers: Record<string, string>,
  tenantHeaders: ProxyTenantHeaders,
) {
  for (const [key, value] of Object.entries(tenantHeaders)) {
    if (typeof value === "string" && value.length > 0) {
      headers[key] = value;
    }
  }
}
