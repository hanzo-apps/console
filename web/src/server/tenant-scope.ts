/**
 * Pure tenant-scope resolution for the embed SSO proxy — decomplected from the
 * session/IO wiring in `tenant-headers.ts` so the security-critical logic
 * (which org/project a proxied request is allowed to be scoped to) can be unit
 * tested in isolation, with no server imports.
 *
 * The rule: the embed iframe DECLARES a project (via `?projectId=` on its src,
 * which also rides along on the Referer of the SPA's sub-requests); we accept it
 * ONLY if the verified session proves the user has a role in that project's org.
 * We never fall back to "first org" — an unauthorized/absent claim yields no
 * tenant, so a downstream service stays unscoped/denied rather than receiving
 * another tenant's headers.
 */

/** The minimal session view this module needs (subset of the real Session). */
export type TenantScopeSession = {
  user?: {
    id?: string | null;
    organizations: Array<{
      id: string;
      projects: Array<{ id: string }>;
    }>;
  } | null;
} | null;

/** First non-empty trimmed string. */
function firstTruthy(
  values: Array<string | undefined | null>,
): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0)
      return value.trim();
  }
  return undefined;
}

/**
 * Extract the declared project id from the proxy request inputs. `query` is the
 * parsed request query; `referer` is the Referer/Referrer header (the iframe
 * document URL, which carries `?projectId=` and may carry a `/project/<id>/`
 * path). This is only a CLAIM — authorize it via {@link resolveTenantScope}.
 */
export function requestedProjectId(inputs: {
  query?: Record<string, string | string[] | undefined>;
  referer?: string | string[] | undefined;
}): string | undefined {
  const q = inputs.query?.projectId;
  const fromQuery = Array.isArray(q) ? q[0] : q;
  if (typeof fromQuery === "string" && fromQuery.trim())
    return fromQuery.trim();

  const refStr = Array.isArray(inputs.referer)
    ? inputs.referer[0]
    : inputs.referer;
  if (typeof refStr === "string" && refStr) {
    try {
      const url = new URL(refStr, "http://localhost");
      const fromRefQuery = url.searchParams.get("projectId");
      if (fromRefQuery && fromRefQuery.trim()) return fromRefQuery.trim();
      const m = url.pathname.match(/\/project\/([^/?#]+)/);
      if (m?.[1]) return decodeURIComponent(m[1]);
    } catch {
      // ignore malformed Referer
    }
  }
  return undefined;
}

/**
 * Authorize a declared project id against the session and resolve the tenant to
 * inject. Returns the org+project ONLY when the user is a member of the
 * declared project's org; otherwise returns just the actor (no tenant headers).
 */
export function resolveTenantScope(
  session: TenantScopeSession,
  declaredProjectId: string | undefined,
): { orgId?: string; projectId?: string; actorId?: string } {
  const user = session?.user;
  const actorId = firstTruthy([user?.id ?? undefined]);
  if (!user || !declaredProjectId) return { actorId };

  for (const org of user.organizations) {
    const project = org.projects.find((p) => p.id === declaredProjectId);
    if (project) return { orgId: org.id, projectId: project.id, actorId };
  }
  return { actorId };
}
