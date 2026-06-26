/**
 * Path classification utilities for layout routing
 * Determines which layout variant to render based on current path
 */

export const PATH_CONSTANTS = {
  withoutNavigation: ["/onboarding", "/auth/reset-password"] as const,
  unauthenticated: [
    "/auth/sign-in",
    "/auth/sign-up",
    "/auth/sso-initiate",
    "/auth/error",
    "/auth/hf-spaces",
  ] as const,
  publishable: [
    "/project/[projectId]/sessions/[sessionId]",
    "/project/[projectId]/traces/[traceId]",
    "/auth/reset-password",
    "/auth/setup-password",
  ] as const,
};

export type LayoutType =
  | "loading"
  | "unauthenticated"
  | "minimal"
  | "authenticated";

/**
 * Result of path classification
 * Used by useLayoutConfiguration to determine the final layout
 */
export type PathClassification = {
  /** Whether this is an auth page (sign-in, sign-up, etc.) */
  isAuthPage: boolean;
  /** Whether navigation should be hidden (public, onboarding, auth pages) */
  hideNavigation: boolean;
  /** Whether this path can be accessed without authentication (shared traces/sessions) */
  isPublishable: boolean;
};

/**
 * Classifies the current path to provide layout hints
 * The final layout decision is made in useLayoutConfiguration based on
 * both path classification AND session state.
 */
export function classifyPath(
  pathname: string,
  _asPath: string,
): PathClassification {
  const isPublicPath = pathname.startsWith("/public/");
  const isWithoutNavigation = PATH_CONSTANTS.withoutNavigation.some((path) =>
    pathname.startsWith(path),
  );
  const isAuthPage = PATH_CONSTANTS.unauthenticated.some((path) =>
    pathname.startsWith(path),
  );
  // Check if path is publishable (can be accessed without authentication)
  const isPublishable = PATH_CONSTANTS.publishable.some((path) => {
    // Case 1: Exact match (e.g., pathname === "/auth/reset-password")
    if (pathname === path) return true;

    // Case 2: Prefix match for dynamic routes
    // Example: path = "/project/[projectId]/traces/[traceId]"
    //   -> pathPrefix = "/project/[^/]+/traces" (last segment removed, params converted to regex)
    //   -> matches pathname like "/project/abc123/traces/xyz789"
    // This allows shared trace/session links to be accessed without authentication
    const pathPrefix = path
      .split("/")
      .slice(0, -1)
      .join("/")
      .replace(/\[([^\]]+)\]/g, "[^/]+");
    const prefixRegex = new RegExp(`^${pathPrefix}/`);
    return prefixRegex.test(pathname);
  });

  // Determine if navigation should be hidden
  const hideNavigation = isPublicPath || isWithoutNavigation || isAuthPage;

  return {
    isAuthPage,
    hideNavigation,
    isPublishable,
  };
}

/**
 * Determines if a route path is currently active
 * Handles exact matches and prefix matching with special logic for root paths
 *
 * @param routePath - The route path pattern (e.g., "/project/[projectId]/traces")
 * @param currentPath - The current router path
 * @returns true if the route should be highlighted as active
 */
export function isPathActive(routePath: string, currentPath: string): boolean {
  // Exact match
  if (currentPath === routePath) return true;

  // Only allow prefix matching if the route ends with a specific page (not just project root)
  // This prevents /project/123 from matching /project/123/datasets
  const isRoot = routePath.split("/").length <= 3;
  if (isRoot) return false;

  return currentPath.startsWith(routePath + "/");
}

/**
 * Among a known set of navigation `candidatePaths`, decide whether `routePath`
 * is the *most specific* one that matches `currentPath`.
 *
 * `isPathActive` alone prefix-matches, so a parent nav item (".../agents") also
 * lights up when a deeper sibling is the current page (".../agents/metrics") —
 * the double-highlight bug. Requiring that no longer candidate also matches
 * keeps a single highlight, while still activating the closest section item for
 * a sub-page that is NOT itself a nav item (e.g. the ".../vector/collections"
 * tab, or a ".../traces/[traceId]" detail page).
 */
export function isMostSpecificActive(
  routePath: string,
  currentPath: string,
  candidatePaths: readonly string[],
): boolean {
  if (!isPathActive(routePath, currentPath)) return false;
  // A longer candidate that also matches is strictly more specific, so this one
  // is not the active item. (Equal-length distinct paths can't both match.)
  return !candidatePaths.some(
    (other) =>
      other.length > routePath.length && isPathActive(other, currentPath),
  );
}
