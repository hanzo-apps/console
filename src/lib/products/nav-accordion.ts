/**
 * Sidebar category accordion — the pure open/collapse model for the level-1
 * product nav. Each CATEGORY is an INDEPENDENTLY collapsible section; this module
 * holds the tiny decision logic (what renders open, how a toggle mutates it) with
 * NO React, so it is unit-testable in isolation and the shell (`Dashboard`)
 * stays a thin binding over it.
 *
 * EXPAND-BY-DEFAULT: every category renders EXPANDED by default — nothing
 * auto-collapses, so the whole product catalog reads at a glance (OBSERVE, PLATFORM,
 * DEV, APPS, SETTINGS, … all open). A user may explicitly COLLAPSE any section (the
 * optional per-section chevron); that ONE choice is persisted per-user (account-backed
 * + localStorage cache) via `usePreferences` under `NAV_OPEN_PREF` and RESPECTED on
 * every render — the section stays exactly where the user left it. While FILTERING,
 * every section opens so a search match is never hidden behind a collapsed section.
 *
 * This is NOT a single-open accordion: collapsing one section leaves the others
 * untouched (each is independent), so the default is a fully-expanded nav.
 */

/** The user's EXPLICIT per-section open/closed choices (sparse). A MISSING key = the
 *  default (OPEN). A stored `false` = the user collapsed that section; `true` = the
 *  user re-opened one they'd collapsed. Kept as a Record for preference-shape stability. */
export type CategoryOpen = Partial<Record<string, boolean>>

/** Preference key (account-backed prefs) for the accordion open-state. */
export const NAV_OPEN_PREF = 'navCategoriesOpen'

/** A stable empty reference for the prefs fallback (avoids a fresh object per read,
 *  which would otherwise re-trigger memo/effect deps downstream). */
export const EMPTY_OPEN: CategoryOpen = {}

/**
 * Whether a category renders EXPANDED, given the user's stored choices + context:
 *  - while FILTERING: always open, so a match is never hidden behind a collapsed
 *    section (the group list is already narrowed to non-empty matches);
 *  - otherwise: the user's EXPLICIT choice if they made one, else the DEFAULT (OPEN).
 *    A section the user never touched is open; one they collapsed stays collapsed
 *    (and one they re-opened stays open) — it stays where the user left it.
 */
export function categoryIsOpen(
  stored: CategoryOpen,
  category: string,
  ctx: { filtering: boolean },
): boolean {
  if (ctx.filtering) return true
  const v = stored[category]
  return v === undefined ? true : v
}

/**
 * Toggle a single category (pure + immutable — never mutates the input). Each
 * section is INDEPENDENT (NOT single-open): toggling one leaves every other one
 * exactly as it was. A section with no stored choice is OPEN by default, so its
 * first toggle COLLAPSES it (stores `false`); toggling again re-opens it (`true`).
 */
export function toggleCategory(stored: CategoryOpen, category: string): CategoryOpen {
  const current = stored[category] === undefined ? true : stored[category]
  return { ...stored, [category]: !current }
}
