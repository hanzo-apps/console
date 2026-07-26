/**
 * ramp — the ONE categorical scale for the console's data marks.
 *
 * `tone.ts` answers "what does this STATE mean" (healthy / failed / pending) and
 * resolves to a theme token. This answers a different question: "how do I tell N
 * unlabelled CATEGORIES apart" — a donut's slices, a graph's node kinds, a funding
 * class. Two questions, two maps, neither repeated.
 *
 * MONOCHROME, per the design system: a monotonic descending-lightness neutral ramp
 * (zero saturation) off the design neutral ladder, never a saturated rainbow. The
 * lead entry is the near-white accent used by sparklines and hero graphics.
 *
 * Concrete hex, not a `$token` / `var()`: these are painted into a canvas 2D context
 * and into SVG marks, where a token string does not resolve. Kept in a pure module
 * (no React) so node-tested logic — `provider-billing`, `graph-logic` — can share the
 * exact same scale instead of hand-copying its steps.
 */

/** The ordered scale. Index 0 reads brightest — give it the category you most want seen. */
export const RAMP = [
  '#EDEDED',
  '#D4D4D4',
  '#BBBBBB',
  '#A3A3A3',
  '#8A8A8A',
  '#737373',
  '#5A5A5A',
  '#454545',
]

/** The catch-all step, below the scale — "Other", unclassified, unknown. */
export const OTHER = '#404040'

/** The n-th category's color, wrapping past the end of the scale. */
export function step(n: number): string {
  return RAMP[((n % RAMP.length) + RAMP.length) % RAMP.length]
}
