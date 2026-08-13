import { describe, it, expect } from 'vitest'

import { placeCoachMark, onScreen, clearOf, centerBox, GAP, type Box, type Side } from './place'

const VP = { width: 1280, height: 720 }
const CARD: Box = { top: 0, left: 0, width: 344, height: 200 }

describe('placeCoachMark', () => {
  it('honors the declared side when there is room', () => {
    const target: Box = { top: 300, left: 400, width: 200, height: 40 }
    expect(placeCoachMark(target, 'bottom', CARD, VP).side).toBe('bottom')
    expect(placeCoachMark(target, 'top', CARD, VP).side).toBe('top')
    expect(placeCoachMark(target, 'right', CARD, VP).side).toBe('right')
    expect(placeCoachMark(target, 'left', CARD, VP).side).toBe('left')
  })

  it('sits one GAP off the target on the declared side', () => {
    const target: Box = { top: 300, left: 400, width: 200, height: 40 }
    expect(placeCoachMark(target, 'bottom', CARD, VP).box.top).toBe(300 + 40 + GAP)
    expect(placeCoachMark(target, 'right', CARD, VP).box.left).toBe(400 + 200 + GAP)
  })

  it('flips to the opposite side when the declared one is off-screen', () => {
    // Hard against the right edge: "right" has nowhere to go, "left" does.
    const target: Box = { top: 300, left: 1180, width: 90, height: 40 }
    expect(placeCoachMark(target, 'right', CARD, VP).side).toBe('left')
    // Hard against the top: "top" would be negative.
    const high: Box = { top: 4, left: 400, width: 200, height: 40 }
    expect(placeCoachMark(high, 'top', CARD, VP).side).toBe('bottom')
  })

  it('centers a step with no target or an explicit center placement', () => {
    expect(placeCoachMark(null, 'bottom', CARD, VP)).toEqual({ box: centerBox(CARD, VP), side: 'center' })
    const target: Box = { top: 300, left: 400, width: 200, height: 40 }
    expect(placeCoachMark(target, 'center', CARD, VP).side).toBe('center')
    expect(placeCoachMark(target, undefined, CARD, VP).side).toBe('center')
  })

  it('centers only when NO side can hold the card — a viewport-filling target', () => {
    // The real response panel: 952x448 in a 1280x720 viewport leaves no band deep
    // or wide enough for a 344x200 card on any side.
    const panel: Box = { top: 150, left: 296, width: 952, height: 448 }
    expect(placeCoachMark(panel, 'bottom', CARD, VP).side).toBe('center')
  })

  /**
   * THE guarantee: whenever any side can hold the card fully on screen and clear of
   * the target, placement finds one. This is the property the browser spec cannot
   * assert cheaply, so it is proven here — over a sweep, not a handful of cases.
   */
  it('never covers the target when some side could avoid it', () => {
    const sides: Side[] = ['top', 'bottom', 'left', 'right']
    for (const declared of sides) {
      for (let top = 0; top <= 600; top += 60) {
        for (let left = 0; left <= 1100; left += 100) {
          for (const size of [
            { width: 60, height: 30 },
            { width: 340, height: 120 },
            { width: 700, height: 40 },
          ]) {
            const target: Box = { top, left, ...size }
            const { box } = placeCoachMark(target, declared, CARD, VP)
            const clearExists = sides.some((s) => {
              const c = placeCoachMark(target, s, CARD, VP)
              return c.side !== 'center' && onScreen(c.box, VP) && clearOf(c.box, target)
            })
            if (clearExists) {
              expect(
                onScreen(box, VP) && clearOf(box, target),
                `declared=${declared} target=${JSON.stringify(target)} → ${JSON.stringify(box)}`,
              ).toBe(true)
            }
          }
        }
      }
    }
  })

  it('always returns a box that is on screen', () => {
    for (const declared of ['top', 'bottom', 'left', 'right'] as Side[]) {
      for (const target of [
        { top: 0, left: 0, width: 1280, height: 720 },
        { top: 700, left: 1270, width: 10, height: 20 },
        { top: -50, left: -50, width: 100, height: 100 },
      ] as Box[]) {
        const { box } = placeCoachMark(target, declared, CARD, VP)
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.top).toBeGreaterThanOrEqual(0)
        expect(box.left + box.width).toBeLessThanOrEqual(VP.width)
        expect(box.top + box.height).toBeLessThanOrEqual(VP.height)
      }
    }
  })

  it('fits a phone viewport', () => {
    const phone = { width: 390, height: 844 }
    const card: Box = { top: 0, left: 0, width: 358, height: 220 }
    const target: Box = { top: 400, left: 16, width: 358, height: 44 }
    const { box } = placeCoachMark(target, 'right', card, phone)
    expect(onScreen(box, phone)).toBe(true)
    expect(clearOf(box, target)).toBe(true)
  })
})
