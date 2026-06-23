import {
  requestedProjectId,
  resolveTenantScope,
  type TenantScopeSession,
} from "./tenant-scope";

/**
 * Security-critical: the embed proxy must scope a request to the org the iframe
 * belongs to AND ONLY when the session proves access — never to an arbitrary
 * org. These pure tests pin both the claim-extraction and the authorization.
 */

describe("requestedProjectId", () => {
  it("reads the projectId from the direct query param", () => {
    expect(requestedProjectId({ query: { projectId: "p-1" } })).toBe("p-1");
  });

  it("reads the projectId from the Referer query (SPA sub-requests)", () => {
    expect(
      requestedProjectId({
        referer: "https://console.hanzo.ai/api/svc/base/_?projectId=p-2",
      }),
    ).toBe("p-2");
  });

  it("falls back to a /project/<id>/ path in the Referer", () => {
    expect(
      requestedProjectId({
        referer: "https://console.hanzo.ai/project/p-3/svc/base",
      }),
    ).toBe("p-3");
  });

  it("prefers the explicit query param over the Referer", () => {
    expect(
      requestedProjectId({
        query: { projectId: "p-query" },
        referer: "https://console.hanzo.ai/project/p-ref/x?projectId=p-ref2",
      }),
    ).toBe("p-query");
  });

  it("returns undefined when nothing declares a project", () => {
    expect(requestedProjectId({})).toBeUndefined();
    expect(requestedProjectId({ referer: "not a url" })).toBeUndefined();
  });
});

describe("resolveTenantScope", () => {
  const session: TenantScopeSession = {
    user: {
      id: "user-1",
      organizations: [
        { id: "org-a", projects: [{ id: "proj-a1" }, { id: "proj-a2" }] },
        { id: "org-b", projects: [{ id: "proj-b1" }] },
      ],
    },
  };

  it("scopes to the org of a project the user is a member of", () => {
    expect(resolveTenantScope(session, "proj-a2")).toEqual({
      orgId: "org-a",
      projectId: "proj-a2",
      actorId: "user-1",
    });
    expect(resolveTenantScope(session, "proj-b1")).toEqual({
      orgId: "org-b",
      projectId: "proj-b1",
      actorId: "user-1",
    });
  });

  it("injects NO tenant for a project the user cannot access (no cross-tenant leak)", () => {
    expect(resolveTenantScope(session, "proj-someone-else")).toEqual({
      actorId: "user-1",
    });
  });

  it("injects NO tenant when no project is declared (no org[0] fallback)", () => {
    expect(resolveTenantScope(session, undefined)).toEqual({
      actorId: "user-1",
    });
  });

  it("returns empty for an anonymous session", () => {
    expect(resolveTenantScope(null, "proj-a1")).toEqual({});
    expect(resolveTenantScope({ user: null }, "proj-a1")).toEqual({});
  });
});
