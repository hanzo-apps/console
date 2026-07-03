/**
 * Org accent theme — the ONE place that turns an organization's saved brand color
 * (`themeData.colorPrimary`, when `themeData.isEnabled`) into the LIVE console accent.
 *
 * The console is monochrome by default; an org opts into a custom accent in Settings →
 * Branding. Saving persists the color on the org record (that half already works). This
 * module is the missing APPLY half: `applyAccent` writes the resolved color to a single
 * root CSS custom property (`--hz-accent` + a readable `--hz-accent-contrast`) and flags
 * `data-hz-accent="on"` on `<html>`. A small, fixed set of genuine accent surfaces
 * (the primary button, the active nav item, the GPU tab bar) read that ONE variable —
 * so the whole accent recolors from a single override point, DRY, and reverts cleanly
 * when the org disables its theme (or the hex is invalid).
 *
 * Pure + SSR-safe: the resolve/contrast helpers are pure (unit-tested); `applyAccent`
 * no-ops when there is no `document` (server render).
 */

/** An org's persisted theme block (mirrors IAM `themeData`; only the fields we apply). */
export type OrgThemeData = {
  colorPrimary?: string
  isEnabled?: boolean
}

/** True for a 3- or 6-digit CSS hex color (`#RGB` / `#RRGGBB`). */
export function isHexColor(v: string | undefined | null): boolean {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim())
}

/**
 * The accent hex to apply for an org, or `null` when no custom accent should be used —
 * i.e. the theme is disabled, missing, or the color is not a valid hex. PURE.
 */
export function resolveAccent(theme: OrgThemeData | null | undefined): string | null {
  if (!theme || !theme.isEnabled) return null
  const hex = (theme.colorPrimary ?? '').trim()
  return isHexColor(hex) ? hex : null
}

/** Expand `#abc` → `#aabbcc`; pass a 6-digit hex through (lowercased). */
function expandHex(hex: string): string {
  const h = hex.trim().toLowerCase()
  if (h.length === 4) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
  return h
}

/**
 * A readable text color (`#000000` / `#ffffff`) for content placed ON the accent,
 * chosen by the accent's relative luminance (WCAG-style). PURE. Falls back to white
 * for a non-hex input (never throws).
 */
export function contrastText(hex: string): '#000000' | '#ffffff' {
  if (!isHexColor(hex)) return '#ffffff'
  const h = expandHex(hex)
  const r = parseInt(h.slice(1, 3), 16) / 255
  const g = parseInt(h.slice(3, 5), 16) / 255
  const b = parseInt(h.slice(5, 7), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance > 0.5 ? '#000000' : '#ffffff'
}

/** The root CSS custom properties + attribute the accent surfaces read. */
const VAR_ACCENT = '--hz-accent'
const VAR_CONTRAST = '--hz-accent-contrast'
const ATTR = 'data-hz-accent'

/**
 * Apply (or clear) the org accent on the document root. `hex` = a valid accent color to
 * turn the accent ON; `null` = revert to the default monochrome accent. SSR-safe (no-op
 * without a `document`). This is the SINGLE override point the whole console reads.
 */
export function applyAccent(hex: string | null): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (hex && isHexColor(hex)) {
    root.style.setProperty(VAR_ACCENT, hex.trim())
    root.style.setProperty(VAR_CONTRAST, contrastText(hex))
    root.setAttribute(ATTR, 'on')
  } else {
    root.style.removeProperty(VAR_ACCENT)
    root.style.removeProperty(VAR_CONTRAST)
    root.removeAttribute(ATTR)
  }
}

/** Resolve an org theme block and apply it in one call (used on load AND on save). */
export function applyOrgAccent(theme: OrgThemeData | null | undefined): void {
  applyAccent(resolveAccent(theme))
}
