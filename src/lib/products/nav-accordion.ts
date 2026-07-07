/**
 * Sidebar category accordion — the pure open/collapse model for the level-1
 * product nav. Each CATEGORY is a collapsible section; this module holds the tiny
 * decision logic (what renders open, how a toggle mutates it) with NO React, so it
 * is unit-testable in isolation and the shell (`DashboardShell`) stays a thin
 * binding over it.
 *
 * SINGLE-OPEN accordion: at most ONE category is expanded at a time. The state is
 * a sparse `Record<category, boolean>` holding the user's single EXPLICIT choice
 * (at most one `true` key), persisted per-user (account-backed) via `usePreferences`
 * under `NAV_OPEN_PREF`. With no explicit choice, the ACTIVE route's category is the
 * one open section — so a fresh user sees a tidy nav (one section open, the rest
 * collapsed), and expanding any category collapses whatever was open before. This is
 * the "only ONE menu open at a time" behavior.
 */

/** The user's single explicit open choice (sparse; at most one `true` key; a missing
 *  key = default). Kept as a Record for preference-shape compatibility. */
export type CategoryOpen = Partial<Record<string, boolean>>

/** Preference key (account-backed prefs) for the accordion open-state. */
export const NAV_OPEN_PREF = 'navCategoriesOpen'

/** A stable empty reference for the prefs fallback (avoids a fresh object per read,
 *  which would otherwise re-trigger memo/effect deps downstream). */
export const EMPTY_OPEN: CategoryOpen = {}

/** The single category the user has explicitly expanded, or `null` if none (in which
 *  case the active route's category is the open one). Enforces the single-open
 *  invariant on read, so a legacy multi-open pref still resolves to exactly one. */
export function openChoice(stored: CategoryOpen): string | null {
  for (const key of Object.keys(stored)) {
    if (stored[key]) return key
  }
  return null
}

/**
 * Whether a category renders EXPANDED (single-open), given the user's choice + context:
 *  - while FILTERING: always open, so a search match is never hidden behind a
 *    collapsed section (the group list is already narrowed to non-empty matches);
 *  - if the user has an explicit choice: EXACTLY that one category is open (every
 *    other collapses — one at a time);
 *  - otherwise (no choice): the ACTIVE route's category is the single open section,
 *    so the current page is always visible.
 */
export function categoryIsOpen(
  stored: CategoryOpen,
  category: string,
  ctx: { activeCategory: string | null; filtering: boolean },
): boolean {
  if (ctx.filtering) return true
  const choice = openChoice(stored)
  if (choice !== null) return category === choice
  return category === ctx.activeCategory
}

/**
 * Toggle a category (pure + immutable — never mutates the input), enforcing the
 * SINGLE-OPEN invariant: opening a category collapses every other one; closing the
 * currently-open category clears the choice (falling back to the active route's
 * section). So the sidebar never shows two expanded menus at once.
 */
export function toggleCategory(stored: CategoryOpen, category: string): CategoryOpen {
  if (openChoice(stored) === category) return {} // close the open one → none chosen
  return { [category]: true } // open ONLY this — collapses whatever was open
}
