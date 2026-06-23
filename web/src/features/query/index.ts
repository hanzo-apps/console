/**
 * Web-side `@/src/features/query` barrel.
 *
 * The query feature was promoted to the shared package (`@hanzo/console`,
 * upstream LFE-9806 / #13678) and now lives at `@hanzo/console/query`. That move
 * deleted `web/src/features/query/` but left dozens of web files still importing
 * from `@/src/features/query`, breaking the build. This barrel restores that
 * import surface by re-exporting the shared query module, plus the one symbol
 * that stayed web-local (`mapLegacyUiTableFilterToView`, which the same refactor
 * extracted into the dashboard lib).
 *
 * Pure re-export — no logic — so it composes with the in-flight query rebuild
 * without owning any of it.
 */
export * from "@hanzo/console/query";
export { mapLegacyUiTableFilterToView } from "@/src/features/dashboard/lib/dashboardUiTableToViewMapping";
