/**
 * `paper` — the ONE surface every anchored overlay wears.
 *
 * A popover, a menu, a switcher and a status panel are the same physical thing: a
 * sheet of paper floating above the page. They were painted two different ways —
 * eleven call sites passed Gui's `elevate`, three wore the design system's
 * `hz-paper` class — so one concept rendered two depths. This is that concept, in
 * one place: spread it onto `Popover.Content` and pass only what is genuinely
 * per-site (padding, width, placement).
 *
 * MATERIAL is `glass`, from `@hanzo/ui/glass.css` (imported in app/layout.tsx). The
 * sheet used to be an opaque `$color2` fill, which on a light canvas is a white slab:
 * it COVERS the page rather than sitting over it, so nothing says which is on top.
 * `.glass` is the hook that package publishes for exactly this case — a hand-rolled
 * menu no `data-slot` names — and it is a translucent ground derived from
 * `--background` plus a backdrop blur. The blur radius, the saturation and the 72%
 * ground live in that file and nowhere else, so this cannot drift from the material
 * the rest of the estate is made of.
 *
 * `bg` is the OPAQUE FALLBACK, not the fill: the material sits inside
 * `@supports (backdrop-filter: …)`, so a browser that cannot blur gets no rule at all
 * — and a menu with no background is a menu you read the page through. It is
 * `$background` because that is the ground the material itself is derived from, so
 * the two paths land in the same place.
 *
 * DEPTH stays `hz-paper` — the console's own anchored-chrome rung (`--hz-ring` +
 * `--hz-paper-highlight` + `--hz-elevation-3` in app/design, light and dark), which
 * every floating surface in this app already stands on. The package's `glass(2)`
 * recipe bundles a rung of its own (`elevation-2`) whose rule carries `!important`,
 * so wearing both would leave two ladders with one of them silently dead. One
 * ladder, and it is the app's.
 *
 * Entrance is `hz-menu-in` — OPACITY only. floating-ui positions an anchored surface
 * with an inline `transform`, and a keyframe that also animates `transform` overrides
 * it for the animation's duration, detaching the menu from its trigger.
 */
export const paper = {
  className: 'glass hz-paper hz-menu-in',
  // `bordered` alone declares the intent and leaves the width at 0, so the sheet
  // met the page with no edge at all. The hairline is stated.
  bordered: true,
  borderWidth: 1,
  bg: '$background',
  borderColor: '$borderColor',
} as const
