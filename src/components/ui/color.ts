/**
 * The radius an icon TILE wears at a given box size — snapped to the console's
 * four-value radius scale (6 control · 8 input/row · 12 panel).
 *
 * A tile's corner has to scale with its box or a small one reads as a circle and
 * a large one as a rectangle, so the rule is proportional — but a bare
 * `size * 0.28` produces a continuous value, and 18px and 40px tiles were
 * painting 5px and 11px corners that belong to no scale. This keeps the optical
 * intent and puts the result back on the scale. ONE rule, every tile.
 *
 * The rest of this module — `asColor`, `IconColor`, `IconLike` — now comes from
 * `@hanzo/ui/product`. This rule stays here because it encodes the CONSOLE's
 * radius scale, and it is the last thing keeping `ProductIcon`/`ProviderLogo`
 * local (see their headers).
 */
export const tileRadius = (size: number): number => (size <= 20 ? 6 : size <= 32 ? 8 : 12)
