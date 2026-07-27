import type { ComponentType } from 'react'
import type { GetThemeValueForKey } from '@hanzo/gui'

/**
 * Bridge between raw CSS colors (product hex accents) and Gui's typed `color`
 * prop. Gui types `color` as a theme-token template (`$color12`, …), but ANY CSS
 * color is valid at runtime — so tinting an icon with a product hex needs one
 * sanctioned cast, in ONE place, rather than `as any` scattered around.
 */
export type IconColor = GetThemeValueForKey<'color'>

/** Cast a raw CSS color (e.g. `#D4D4D4`) to Gui's `color` prop type. */
export const asColor = (hex: string): IconColor => hex as unknown as IconColor

/** A lucide/Gui icon component that accepts a size + a (token-or-cast) color —
 *  the shape the shell passes around for product/nav icons. */
export type IconLike = ComponentType<{ size?: number; color?: IconColor }>

/**
 * The radius an icon TILE wears at a given box size — snapped to the console's
 * four-value radius scale (6 control · 8 input/row · 12 panel).
 *
 * A tile's corner has to scale with its box or a small one reads as a circle and
 * a large one as a rectangle, so the rule is proportional — but a bare
 * `size * 0.28` produces a continuous value, and 18px and 40px tiles were
 * painting 5px and 11px corners that belong to no scale. This keeps the optical
 * intent and puts the result back on the scale. ONE rule, every tile.
 */
export const tileRadius = (size: number): number => (size <= 20 ? 6 : size <= 32 ? 8 : 12)
