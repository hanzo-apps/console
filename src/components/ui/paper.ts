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
 * Elevation comes from the design token ladder (`--hz-elevation-*` + `--hz-ring` +
 * `--hz-paper-highlight` in app/design), NOT from Gui's `elevate`: on the console's
 * true-black canvas a lone cast shadow is nearly invisible, so the ladder pairs the
 * shadow with a hairline ring and a top highlight to lift the sheet off black. The
 * ladder is theme-aware (a light twin) and brand-neutral, so lux/zoo/pars inherit it.
 *
 * Entrance is `hz-menu-in` — OPACITY only. floating-ui positions an anchored surface
 * with an inline `transform`, and a keyframe that also animates `transform` overrides
 * it for the animation's duration, detaching the menu from its trigger.
 */
export const paper = {
  className: 'hz-paper hz-menu-in',
  // `bordered` alone declares the intent and leaves the width at 0, so the sheet
  // met the page with no edge at all. The hairline is stated.
  bordered: true,
  borderWidth: 1,
  bg: '$color2',
  borderColor: '$borderColor',
} as const
