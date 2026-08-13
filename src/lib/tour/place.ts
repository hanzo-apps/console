/**
 * Where the coach-mark goes — PURE geometry, so it can be reasoned about and tested
 * without a browser.
 *
 * A step's `placement` is a PREFERENCE, not a promise. The author knows which side
 * reads best; only the running viewport knows which side there is room on. So this
 * takes the preference, generates the real candidate boxes, and picks the first one
 * that is (a) fully on screen and (b) CLEAR OF THE TARGET — because a card sitting on
 * top of the element it is describing is worse than a card on the "wrong" side.
 *
 * The fallbacks are ordered, not clever: the declared side, its opposite, then the
 * remaining sides, then dead centre. Deterministic beats optimal here — a tutorial
 * whose card jumps to a different corner on a 1px resize is its own kind of broken.
 */

export type Box = { top: number; left: number; width: number; height: number }
export type Side = 'top' | 'bottom' | 'left' | 'right' | 'center'

/** Gap between the target's halo and the card. */
export const GAP = 12

export type Viewport = { width: number; height: number }

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, max))

const OPPOSITE: Record<Exclude<Side, 'center'>, Exclude<Side, 'center'>> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

/** The card box for one side, with the cross axis kept inside the viewport. */
function boxOn(side: Exclude<Side, 'center'>, target: Box, card: Box, vp: Viewport): Box {
  const x = clamp(target.left, GAP, Math.max(GAP, vp.width - card.width - GAP))
  const y = clamp(target.top, GAP, Math.max(GAP, vp.height - card.height - GAP))
  switch (side) {
    case 'bottom':
      return { top: target.top + target.height + GAP, left: x, width: card.width, height: card.height }
    case 'top':
      return { top: target.top - GAP - card.height, left: x, width: card.width, height: card.height }
    case 'right':
      return { top: y, left: target.left + target.width + GAP, width: card.width, height: card.height }
    case 'left':
      return { top: y, left: target.left - GAP - card.width, width: card.width, height: card.height }
  }
}

/** Dead centre of the viewport. */
export function centerBox(card: Box, vp: Viewport): Box {
  return {
    top: Math.max(GAP, Math.round((vp.height - card.height) / 2)),
    left: Math.max(GAP, Math.round((vp.width - card.width) / 2)),
    width: card.width,
    height: card.height,
  }
}

/** Wholly inside the viewport. */
export function onScreen(b: Box, vp: Viewport): boolean {
  return b.left >= 0 && b.top >= 0 && b.left + b.width <= vp.width && b.top + b.height <= vp.height
}

/** No overlap with the target (its halo included). */
export function clearOf(b: Box, target: Box, pad = 6): boolean {
  return (
    b.left >= target.left + target.width + pad ||
    b.left + b.width <= target.left - pad ||
    b.top >= target.top + target.height + pad ||
    b.top + b.height <= target.top - pad
  )
}

/**
 * The coach-mark's box for a step. `target` is null (or the step is centered) ⟹ dead
 * centre; otherwise the best available side by the order described above.
 */
export function placeCoachMark(
  target: Box | null,
  placement: Side | undefined,
  card: Box,
  vp: Viewport,
): { box: Box; side: Side } {
  if (!target || !placement || placement === 'center') return { box: centerBox(card, vp), side: 'center' }

  const first = placement as Exclude<Side, 'center'>
  const order: Exclude<Side, 'center'>[] = []
  for (const s of [first, OPPOSITE[first], 'bottom', 'top', 'right', 'left'] as Exclude<Side, 'center'>[]) {
    if (!order.includes(s)) order.push(s)
  }
  const boxes = order.map((side) => ({ side, box: boxOn(side, target, card, vp) }))

  const best = boxes.find((c) => onScreen(c.box, vp) && clearOf(c.box, target))
  if (best) return best
  const fits = boxes.find((c) => onScreen(c.box, vp))
  if (fits) return fits
  return { box: centerBox(card, vp), side: 'center' }
}
