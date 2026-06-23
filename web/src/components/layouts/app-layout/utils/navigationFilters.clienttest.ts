import { filters, applyNavigationFilters } from "./navigationFilters";
import type { NavigationFilterContext } from "./navigationFilters.types";
import { ROUTES, type Route } from "@/src/components/layouts/routes";
import { EMBEDDED_SERVICE_NAV } from "@/src/features/embedded-services/registry";

/**
 * Org-gate (multi-tenant) tests.
 *
 * Requirement A: no app/service surface is visible until an organization is
 * selected. An org is "selected" when the URL carries an organization id OR a
 * project id (a project always belongs to one org).
 */

function ctx(
  overrides: Partial<NavigationFilterContext> = {},
): NavigationFilterContext {
  return {
    routerProjectId: undefined,
    routerOrganizationId: undefined,
    session: null,
    enableExperimentalFeatures: false,
    cloudAdmin: false,
    entitlements: [],
    uiCustomization: null,
    isConsoleCloud: false,
    currentPath: "/",
    ...overrides,
  };
}

describe("filters.requiresOrganization (org-gate)", () => {
  const gated: Route = {
    title: "Gated",
    pathname: "/somewhere",
    requiresOrganization: true,
  };
  const ungated: Route = { title: "Open", pathname: "/" };

  it("hides org-gated routes when no org or project is selected", () => {
    expect(filters.requiresOrganization(gated, ctx())).toBeNull();
  });

  it("shows org-gated routes once an organization is selected", () => {
    expect(
      filters.requiresOrganization(
        gated,
        ctx({ routerOrganizationId: "org-1" }),
      ),
    ).toBe(gated);
  });

  it("shows org-gated routes once a project (implying an org) is selected", () => {
    expect(
      filters.requiresOrganization(gated, ctx({ routerProjectId: "proj-1" })),
    ).toBe(gated);
  });

  it("never hides routes that are not org-gated", () => {
    expect(filters.requiresOrganization(ungated, ctx())).toBe(ungated);
  });
});

describe("org-gate end-to-end over real ROUTES", () => {
  it("exposes NO project/app-service routes before an org is selected", () => {
    const visible = applyNavigationFilters(ROUTES, ctx(), undefined);
    const leaked = visible.filter((r) => r.pathname.includes("[projectId]"));
    expect(leaked).toHaveLength(0);
  });

  it("only surfaces org-level entry points (no [projectId]) at the landing", () => {
    const visible = applyNavigationFilters(ROUTES, ctx(), undefined);
    // Everything visible at "/" must be an org-or-global entry (Organizations,
    // Go to..., Cloud Status, Support, etc.), never a project app/service page.
    for (const route of visible) {
      expect(route.pathname.includes("[projectId]")).toBe(false);
    }
  });

  it("surfaces project app/service routes once a project is selected", () => {
    const visible = applyNavigationFilters(
      ROUTES,
      ctx({ routerProjectId: "proj-1", cloudAdmin: true }),
      { id: "org-1" } as never,
    );
    const projectRoutes = visible.filter((r) =>
      r.pathname.startsWith("/project/[projectId]"),
    );
    expect(projectRoutes.length).toBeGreaterThan(0);
  });
});

describe("Embedded services are registry-driven org-scoped pages (not link-outs)", () => {
  it("every registry service has exactly one org-scoped /svc/<slug> route", () => {
    for (const svc of EMBEDDED_SERVICE_NAV) {
      const matches = ROUTES.filter(
        (r) => r.pathname === `/project/[projectId]/svc/${svc.slug}`,
      );
      expect(matches).toHaveLength(1);
      const route = matches[0]!;
      expect(route.title).toBe(svc.title);
      expect(route.newTab).not.toBe(true);
      expect(route.pathname.startsWith("http")).toBe(false);
      // Org-gated: the dynamic embed pages must not render before an org/project
      // is selected.
      expect(route.requiresOrganization).toBe(true);
    }
  });

  it("Base and Playground are present as embedded services", () => {
    const slugs = EMBEDDED_SERVICE_NAV.map((s) => s.slug);
    expect(slugs).toContain("base");
    expect(slugs).toContain("playground");
  });

  it("no route is a base.hanzo.ai link-out anymore", () => {
    const linkOuts = ROUTES.filter((r) => r.pathname.includes("base.hanzo.ai"));
    expect(linkOuts).toHaveLength(0);
  });
});
