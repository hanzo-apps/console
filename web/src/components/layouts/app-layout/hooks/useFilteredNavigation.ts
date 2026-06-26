/**
 * Hook to filter and process navigation based on user permissions and context
 * Implements memoization to prevent unnecessary recalculations
 */

import { useRouter } from "next/router";
import { useMemo } from "react";
import type { Session, User } from "@/src/features/auth/session-types";
import { useEntitlements } from "@/src/features/entitlements/hooks";
import { useUiCustomization } from "@/src/features/ui-customization/useUiCustomization";
import { useConsoleCloudRegion } from "@/src/features/organizations/hooks";
import {
  ROUTES,
  RouteSection,
  RouteGroup,
  type Route,
} from "@/src/components/layouts/routes";
import type { NavigationItem } from "@/src/components/layouts/utilities/routes";
import { applyNavigationFilters } from "../utils/navigationFilters";
import type { NavigationFilterContext } from "../utils/navigationFilters.types";
import { isMostSpecificActive } from "../utils/pathClassification";

/** Organization type from user session (can be null when not in project/org context) */
type Organization = User["organizations"][number] | null | undefined;

/** Grouped navigation structure */
type GroupedNavigation = {
  ungrouped: NavigationItem[];
  grouped: Partial<Record<RouteGroup, NavigationItem[]>> | null;
  flattened: NavigationItem[];
};

/**
 * Groups navigation items by RouteGroup
 */
function groupNavigationItems(items: NavigationItem[]): GroupedNavigation {
  const ungrouped = items.filter((item) => !item.group);
  const grouped: Partial<Record<RouteGroup, NavigationItem[]>> = {};

  items.forEach((item) => {
    if (item.group) {
      if (!grouped[item.group]) {
        grouped[item.group] = [];
      }
      grouped[item.group]!.push(item);
    }
  });

  const groupedResult = Object.keys(grouped).length > 0 ? grouped : null;
  // Flatten EVERY visible group (in insertion = route-declaration order) so the
  // command menu and any flat consumer stay in sync with the grouped sidebar.
  // (Previously only 3 groups were hardcoded here, hiding Search & AI etc. from
  // Cmd+K even though they rendered in the nav.)
  const groupedItems = groupedResult ? Object.values(grouped).flat() : [];

  return {
    ungrouped,
    grouped: groupedResult,
    flattened: [...ungrouped, ...groupedItems],
  };
}

/**
 * Filters and processes navigation items based on:
 * - Project/organization context
 * - User permissions (RBAC)
 * - Plan entitlements
 * - Feature flags
 * - UI customization settings
 *
 * Returns navigation split into main/secondary sections with active states
 *
 * @param session - Current user session
 * @param organization - Current organization object
 * @returns Processed navigation with main, secondary, and flattened arrays
 */
export function useFilteredNavigation(
  session: Session | null,
  organization: Organization,
) {
  const router = useRouter();
  const entitlements = useEntitlements();
  const uiCustomization = useUiCustomization();
  const { isConsoleCloud, region } = useConsoleCloudRegion();

  const routerProjectId = router.query.projectId as string | undefined;
  const routerOrganizationId = router.query.organizationId as
    | string
    | undefined;

  // Memoize filter context to prevent unnecessary recalculations
  const filterContext = useMemo<NavigationFilterContext>(
    () => ({
      routerProjectId,
      routerOrganizationId,
      session,
      enableExperimentalFeatures:
        session?.environment?.enableExperimentalFeatures ?? false,
      cloudAdmin: Boolean(
        session?.user?.admin && isConsoleCloud && region !== "DEV",
      ),
      entitlements,
      uiCustomization,
      currentPath: router.asPath,
    }),
    [
      routerProjectId,
      routerOrganizationId,
      session,
      entitlements,
      uiCustomization,
      router.asPath,
      isConsoleCloud,
      region,
    ],
  );

  // Memoize filtered routes
  const filteredRoutes = useMemo(() => {
    return applyNavigationFilters(ROUTES, filterContext, organization);
  }, [filterContext, organization]);

  // Map filtered routes to NavigationItems with url and isActive
  // This is O(n) - we map directly over filteredRoutes instead of re-iterating ROUTES
  return useMemo(() => {
    // Flat set of every nav pathname (incl. nested items) so active-state can
    // pick the single most-specific match — no parent+child double-highlight.
    const candidatePaths: string[] = [];
    const collectPaths = (routes: Route[]): void => {
      for (const r of routes) {
        candidatePaths.push(r.pathname);
        if (r.items) collectPaths(r.items);
      }
    };
    collectPaths(filteredRoutes);

    const mapRouteToNavigationItem = (route: Route): NavigationItem => {
      const url = route.pathname
        .replace("[projectId]", routerProjectId ?? "")
        .replace("[organizationId]", routerOrganizationId ?? "");

      // Recursively map nested items (already filtered by applyNavigationFilters)
      const items: NavigationItem[] | undefined = route.items
        ?.map(mapRouteToNavigationItem)
        .filter((item): item is NavigationItem => item !== null);

      return {
        ...route,
        url,
        isActive: isMostSpecificActive(
          route.pathname,
          router.pathname,
          candidatePaths,
        ),
        items: items && items.length > 0 ? items : undefined,
      };
    };

    // Map filtered routes to navigation items
    const allItems = filteredRoutes.map(mapRouteToNavigationItem);

    // Split by section and group
    const mainItems = allItems.filter(
      (item) => item.section === RouteSection.Main,
    );
    const secondaryItems = allItems.filter(
      (item) => item.section === RouteSection.Secondary,
    );

    const mainNavigation = groupNavigationItems(mainItems);
    const secondaryNavigation = groupNavigationItems(secondaryItems);

    return {
      mainNavigation,
      secondaryNavigation,
      navigation: [
        ...mainNavigation.flattened,
        ...secondaryNavigation.flattened,
      ],
    };
  }, [filteredRoutes, routerProjectId, routerOrganizationId, router.pathname]);
}
