/**
 * Sidebar category accordion — the pure open/collapse model for the level-1
 * product nav. Each CATEGORY is a collapsible section; this module holds the tiny
 * decision logic (what renders open, how a toggle mutates it) with NO React, so it
 * is unit-testable in isolation and the shell (`DashboardShell`) stays a thin
 * binding over it.
 *
 * The state is a sparse `Record<category, boolean>` of the user's EXPLICIT
 * choices, persisted per-user (account-backed) via `usePreferences` under
 * `NAV_OPEN_PREF`. A category with NO stored entry uses the honest default —
 * COLLAPSED — so a fresh user sees a tidy, un-overwhelming nav: 13 category
 * headers instead of ~120 flat rows, with only the active route's category open.
 */

/** The user's explicit per-category open choices (sparse; a missing key = default). */
export type CategoryOpen = Partial<Record<string, boolean>>

/** Preference key (account-backed prefs) for the accordion open-state. */
export const NAV_OPEN_PREF = 'navCategoriesOpen'

/** A stable empty reference for the prefs fallback (avoids a fresh object per read,
 *  which would otherwise re-trigger memo/effect deps downstream). */
export const EMPTY_OPEN: CategoryOpen = {}

/**
 * Whether a category renders EXPANDED, given the user's stored choices + context:
 *  - while FILTERING: always open, so a search match is never hidden behind a
 *    collapsed section (the group list is already narrowed to non-empty matches);
 *  - the ACTIVE route's category is always open, so the current page is visible
 *    even if the user had collapsed that category (navigating reveals it);
 *  - otherwise: the user's stored choice, defaulting to COLLAPSED (the tidy default).
 */
export function categoryIsOpen(
  stored: CategoryOpen,
  category: string,
  ctx: { activeCategory: string | null; filtering: boolean },
): boolean {
  if (ctx.filtering) return true
  if (category === ctx.activeCategory) return true
  return stored[category] ?? false
}

/**
 * Toggle a category's stored open choice (pure + immutable — never mutates the
 * input). The default is collapsed, so the first toggle on an untouched category
 * OPENS it. Toggling the active category records a choice that takes effect once
 * the user navigates away (while active it stays visibly open — `categoryIsOpen`
 * keeps the current page's section revealed). Other categories are untouched.
 */
export function toggleCategory(stored: CategoryOpen, category: string): CategoryOpen {
  return { ...stored, [category]: !(stored[category] ?? false) }
}
