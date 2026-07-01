import { describe, it, expect } from 'vitest'

import {
  easeOutCubic,
  countUpValue,
  progress,
  pushSample,
  shouldTick,
  effectiveInterval,
} from './motion'

/**
 * The living-overview motion math is the "videogame" layer, so it is pinned hard:
 * count-up must LAND on the target (no drift, no fabricated overshoot), the live
 * sparkline ring must only ever hold real bounded samples, and the poll clock must
 * be self-correcting + pause when the tab is hidden (no backend hammering, no
 * stacked fetches).
 */

describe('easeOutCubic — clamped ease', () => {
  it('anchors at 0 and 1 and is monotonic', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(-5)).toBe(0) // clamps below
    expect(easeOutCubic(9)).toBe(1) // clamps above
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5) // ease-OUT: ahead of linear
  })
})

describe('countUpValue — interpolates between two REAL values, lands exactly', () => {
  it('returns the target exactly at t>=1 (no float drift)', () => {
    expect(countUpValue(0, 1234, 1)).toBe(1234)
    expect(countUpValue(100, 999, 2)).toBe(999) // t past 1 still lands
  })
  it('starts at from when t=0', () => {
    expect(countUpValue(200, 800, 0)).toBe(200)
  })
  it('is between from and to mid-flight (never overshoots)', () => {
    const v = countUpValue(0, 100, 0.5)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(100)
  })
  it('first-ever value (non-finite from) shows the target, not NaN', () => {
    expect(countUpValue(NaN, 42, 0.3)).toBe(42)
  })
  it('a non-finite target degrades to the prior value (honest, never NaN)', () => {
    expect(countUpValue(7, NaN, 0.5)).toBe(7)
    expect(countUpValue(NaN, NaN, 0.5)).toBe(0)
  })
  it('retargets smoothly from an arbitrary mid-flight value (no snap-back on a new poll)', () => {
    // useCountUp animates from the CURRENT on-screen value when a poll delivers a
    // new target mid-flight. Interpolating from that arbitrary `from` must still
    // start there and land on the new target — never jump back to 0/the old value.
    const midFlight = countUpValue(100, 900, 0.5) // somewhere in (100,900)
    expect(countUpValue(midFlight, 1200, 0)).toBe(midFlight) // continues from here
    expect(countUpValue(midFlight, 1200, 1)).toBe(1200) // lands on the new target
    const step = countUpValue(midFlight, 1200, 0.3)
    expect(step).toBeGreaterThan(midFlight) // moves toward the new target, no snap-back
    expect(step).toBeLessThan(1200)
  })
})

describe('progress — normalized, clamped, self-correcting', () => {
  it('maps elapsed/duration into [0,1]', () => {
    expect(progress(1000, 1000, 600)).toBe(0)
    expect(progress(1000, 1300, 600)).toBe(0.5)
    expect(progress(1000, 5000, 600)).toBe(1) // clamps
  })
  it('a zero/negative duration is instantly complete', () => {
    expect(progress(1000, 1000, 0)).toBe(1)
  })
})

describe('pushSample — bounded live-sparkline ring, real samples only', () => {
  it('appends within cap', () => {
    expect(pushSample([1, 2], 3, 5)).toEqual([1, 2, 3])
  })
  it('evicts the oldest past cap (fixed-size ring)', () => {
    expect(pushSample([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
  })
  it('drops a non-finite reading (never fabricates a point)', () => {
    expect(pushSample([1, 2], NaN, 5)).toEqual([1, 2])
    expect(pushSample([1, 2], Infinity, 5)).toEqual([1, 2])
  })
  it('does not mutate the input array', () => {
    const src = [1, 2, 3]
    pushSample(src, 4, 3)
    expect(src).toEqual([1, 2, 3])
  })
})

describe('shouldTick — poll clock', () => {
  it('fires only after the interval elapses', () => {
    expect(shouldTick(1000, 1500, 1000)).toBe(false)
    expect(shouldTick(1000, 2000, 1000)).toBe(true)
    expect(shouldTick(1000, 2500, 1000)).toBe(true)
  })
  it('a non-positive interval disables polling', () => {
    expect(shouldTick(0, 10_000, 0)).toBe(false)
    expect(shouldTick(0, 10_000, -1)).toBe(false)
  })
})

describe('effectiveInterval — throttle floor + hidden-tab pause', () => {
  it('never goes below the floor', () => {
    expect(effectiveInterval(1000, 5000, false)).toBe(5000)
    expect(effectiveInterval(20_000, 5000, false)).toBe(20_000)
  })
  it('pauses (0) when the tab is hidden', () => {
    expect(effectiveInterval(10_000, 5000, true)).toBe(0)
  })
  it('stays disabled when requested interval is off', () => {
    expect(effectiveInterval(0, 5000, false)).toBe(0)
  })
})
