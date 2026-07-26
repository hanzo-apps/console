'use client'

/**
 * Onboarding local guards — a browser-only backstop so the first-run wizard
 * behaves correctly REGARDLESS of the account-preference write path.
 *
 * The canonical persistence for "onboarding_completed" is the account preference
 * (`usePreferences` → `PrefsApi.merge`), which follows the user across
 * devices. But that write currently rides `POST /v1/iam/update-preferences`, an
 * endpoint the IAM backend does not yet serve (flagged as a backend gap) — the
 * console's optimistic write swallows the failure, so on that backend the account
 * would not remember completion and the wizard could re-nag every load. To keep the
 * UX correct TODAY and upgrade automatically once the endpoint lands, we ALSO record
 * completion in `localStorage` (persists across reloads) and an in-session dismissal
 * in `sessionStorage` (so "I'll finish later" hides it until the next session,
 * keeping the flow resumable). Both are per-account (owner-keyed) and SSR-safe.
 */

const DONE_PREFIX = 'hz_onboarding_done:'
const DISMISS_PREFIX = 'hz_onboarding_dismissed:'

/** True once this account marked onboarding complete on this browser. */
export function isLocallyComplete(owner: string): boolean {
  if (!owner || typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DONE_PREFIX + owner) === '1'
  } catch {
    return false
  }
}

/** Persist a per-account completion flag (survives reloads). */
export function markLocallyComplete(owner: string): void {
  if (!owner || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DONE_PREFIX + owner, '1')
  } catch {
    /* private mode — the account preference remains the source of truth */
  }
}

/** True when the user chose "finish later" earlier in THIS browser session. */
export function isDismissedForSession(owner: string): boolean {
  if (!owner || typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(DISMISS_PREFIX + owner) === '1'
  } catch {
    return false
  }
}

/** Hide the wizard for the rest of this session (resumes next session). */
export function dismissForSession(owner: string): void {
  if (!owner || typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(DISMISS_PREFIX + owner, '1')
  } catch {
    /* private mode — worst case the wizard shows again this session */
  }
}
