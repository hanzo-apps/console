/**
 * The sidebar's persisted view model — what the rail SHOWS and what is OPEN, as
 * pure values with NO React, so the decisions are unit-testable in isolation and
 * the shell (`Dashboard`) stays a thin binding over them.
 *
 * EXPAND-BY-DEFAULT: every category renders EXPANDED by default — nothing
 * auto-collapses, so the whole product catalog reads at a glance (OBSERVE, PLATFORM,
 * DEV, APPS, SETTINGS, … all open). A user may explicitly COLLAPSE any section (the
 * optional per-section chevron); that ONE choice is persisted per-user (account-backed
 * + localStorage cache) via `usePreferences` under `NAV_OPEN_PREF` and RESPECTED on
 * every render — the section stays exactly where the user left it.
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
 * Whether a category renders EXPANDED: the user's EXPLICIT choice if they made one,
 * else the DEFAULT (OPEN). A section the user never touched is open; one they
 * collapsed stays collapsed (and one they re-opened stays open) — it stays where
 * the user left it.
 */
export function categoryIsOpen(stored: CategoryOpen, category: string): boolean {
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

// ── Whether the rail lists the catalog ───────────────────────────────────────

/**
 * Preference key: does the rail list EVERY product, or only the ones you keep?
 *
 * ON (the default) the rail is the whole catalog — every product the viewer may
 * SEE. Permission decides that (admin surfaces stay hidden; a brand shows only its
 * own categories); what the org has ENABLED does not, because every product is
 * available to every org on demand. The All-products panel had already settled this
 * for itself and the rail had not, so one catalog came back two different sizes
 * depending which you asked.
 *
 * OFF narrows the rail to the org's enabled set, plus what you pinned and wherever
 * you are — just what you work with. Nothing is unreachable either way: the search
 * box at the head of the rail asks the whole catalog, and "All products" at its foot
 * lists all of it.
 */
export const NAV_CATALOG_PREF = 'navCatalog'
