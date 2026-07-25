/**
 * The ONE tone map, in CSS-value form.
 *
 * `tone.ts` speaks Tamagui tokens (`$color12`), which is what a `color=` / `bg=` prop
 * wants. A raw `style={{…}}` object and an SVG presentation attribute are plain CSS —
 * a `$token` string does not resolve there — so those sites need `var(--color12)`.
 *
 * This is an ADAPTER over `tone.ts`, not a second ladder: the emphasis order lives in
 * exactly one place and this only restates the token as CSS. Charts already rely on the
 * same form (`useTheme().<token>.get()` → `var(--token)` on web), so an SVG mark drawn
 * this way stays theme-reactive.
 */
import { toneColor, toneOfStatus, type Tone } from './tone'

/** A tone as a CSS value — `style={{…}}` objects, SVG `fill`/`stroke`, chart colors. */
export function toneVar(tone: Tone): string {
  return `var(--${toneColor(tone).slice(1)})`
}

/** A raw status string as a CSS value — `toneVar ∘ toneOfStatus`. */
export function statusVar(status: string): string {
  return toneVar(toneOfStatus(status))
}
