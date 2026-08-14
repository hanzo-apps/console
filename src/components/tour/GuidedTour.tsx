'use client'

/**
 * GuidedTour — a fully NATIVE, self-contained guided-tour overlay. Zero external
 * scripts (no Appcues/driver.js), zero new deps — so it works inside the published
 * static console and under any CSP. It spotlights a step's `data-tour` target with a
 * box-shadow cutout and floats a coach-mark beside it; Next/Back/Skip, a step
 * counter, Escape and the arrow keys drive it.
 *
 * ── IT RENDERS IN A PORTAL, AND THAT IS THE WHOLE POINT ────────────────────────────
 * `position: fixed` is only viewport-relative while NO ancestor establishes a
 * containing block. This overlay is mounted from `PitchHero`, whose card sits inside
 * `<FadeIn>` — and `.hz-fade-up` carries `will-change: transform` plus an animation
 * that leaves `transform: translateY(0)` behind. Either one makes that div the
 * containing block for every fixed descendant, so the tour was laid out relative to
 * the CARD and then clipped by its `overflow: hidden`: the backdrop dimmed only the
 * card, and the spotlight — measured in viewport coordinates but painted in card
 * coordinates — landed hundreds of pixels from its target, usually outside the clip.
 * Clicking "Take the tour" therefore looked like it did nothing.
 *
 * Portalling to `document.body` puts the overlay outside every transformed ancestor
 * for good, so no caller can reintroduce the bug by wrapping us in a card, a fade or
 * a drawer.
 *
 * @hanzo/gui v5 shorthands for chrome; arbitrary fixed/absolute positioning goes
 * through `style` (the Charts.tsx convention — Tamagui bg/color props take tokens,
 * numeric layout math takes `style`). SSR-safe: renders null on the server.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, ArrowRight, Check, X } from '@hanzogui/lucide-icons-2'

import { isLast, nextIndex, planTour, prevIndex, sameRoute, type TourStep } from '~/lib/tour/steps'
import { placeCoachMark } from '~/lib/tour/place'
import { useReducedMotion } from '~/components/products/overview/living/hooks'
import { Z } from '~/lib/z'

type Rect = { top: number; left: number; width: number; height: number }

const CARD_W = 344
/** Fallback card height before the real one is measured (first paint only). */
const CARD_H = 208
/** How long to wait for a step's anchor (a route change + a lazy pane to mount). */
const FIND_MS = 2500
const POLL_MS = 100

/** The first VISIBLE match for a selector, or null. */
function findTarget(target?: string): Element | null {
  if (!target || typeof document === 'undefined') return null
  // The FIRST VISIBLE match, not merely the first: an anchor id can appear in a
  // hidden twin (a collapsed rail, an unmounted pane) whose zero/offscreen box
  // would strand the spotlight.
  const all = Array.from(document.querySelectorAll(target))
  return (
    all.find((e) => {
      const r = e.getBoundingClientRect()
      return r.width >= 1 && r.height >= 1
    }) ?? null
  )
}

/**
 * The spotlight rect for an element, or null when it should be CENTERED instead.
 * An anchor larger than most of the viewport is a container, not a target —
 * spotlighting it dims nothing and confuses everything.
 */
function rectOf(el: Element): Rect | null {
  if (typeof window === 'undefined') return null
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  if (r.width * r.height > window.innerWidth * window.innerHeight * 0.7) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

/**
 * Bring a scrolled-away target into view — a step about an element nobody can see is
 * no step.
 *
 * The scroll is INSTANT on purpose. A smooth scroll moves the target for ~300ms while
 * the spotlight is also gliding to it, and the two fight: the ring trails the thing it
 * is ringing. Under a 62% scrim the jump is barely visible, and it leaves exactly one
 * thing in motion — the spotlight — which is the motion that carries the meaning.
 */
function reveal(el: Element, placement: TourStep['placement'], cardH: number): void {
  const vp = { width: window.innerWidth, height: window.innerHeight }
  const r0 = el.getBoundingClientRect()
  // Leave room for the coach-mark: a target hugging either edge gets recentred.
  if (r0.bottom > vp.height - 120 || r0.top < 100) el.scrollIntoView({ block: 'center', behavior: 'auto' })

  if (!placement || placement === 'center') return
  // A TALL target centred can leave a band on every side that is too shallow for the
  // card — and then the card has nowhere to go but on top of the thing it describes.
  // Pinning the target's top gathers all the slack in one place, below it, which is
  // where a card can actually live. Asked of the same function that does the placing,
  // so "does a side fit" has exactly one definition.
  const card = { top: 0, left: 0, width: Math.min(CARD_W, Math.round(vp.width * 0.92)), height: cardH }
  const fits = (): boolean => {
    const r = el.getBoundingClientRect()
    const t = { top: r.top, left: r.left, width: r.width, height: r.height }
    return placeCoachMark(t, placement, card, vp).side !== 'center'
  }
  if (!fits()) el.scrollIntoView({ block: 'start', behavior: 'auto' })
}

/** Fixed-position style for the coach-mark — the pure placement, made into CSS. */
function tooltipStyle(rect: Rect | null, placement: TourStep['placement'], cardH: number): CSSProperties {
  const vp = {
    width: typeof window === 'undefined' ? 1200 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }
  const width = Math.min(CARD_W, Math.round(vp.width * 0.92))
  const { box } = placeCoachMark(
    rect ? { ...rect, width: rect.width, height: rect.height } : null,
    placement,
    { top: 0, left: 0, width, height: cardH },
    vp,
  )
  return { position: 'fixed', top: box.top, left: box.left, width, maxWidth: '92vw', zIndex: Z.popover }
}

/**
 * A dot per stop, the one you are on stretched. Its OWN row: sharing a row with the
 * buttons put nine dots, a counter and three controls in 344px, and they collided —
 * the counter printed straight through "Skip". A row of its own cannot overflow
 * whatever a tour's length turns out to be.
 */
function Dots({ index, total }: { index: number; total: number }) {
  return (
    <XStack items="center" gap={4} aria-hidden flexWrap="wrap">
      {Array.from({ length: total }, (_, i) => (
        <YStack
          key={i}
          width={i === index ? 16 : 5}
          height={5}
          rounded="$10"
          bg={i <= index ? '$color12' : '$color6'}
          opacity={i <= index ? 1 : 0.6}
        />
      ))}
    </XStack>
  )
}

export function GuidedTour({
  steps,
  open,
  onClose,
  onFinish,
}: {
  steps: TourStep[]
  open: boolean
  onClose: () => void
  onFinish?: () => void
}) {
  const router = useRouter()
  // `usePathname` is nullable in the app router's types; the console home IS "/".
  const pathname = usePathname() ?? '/'
  const reduced = useReducedMotion()

  const [plan, setPlan] = useState<TourStep[]>([])
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [placed, setPlaced] = useState(false)
  const [cardH, setCardH] = useState(CARD_H)
  /**
   * True only while the overlay is travelling from one step to the next. The glide
   * IS the tutorial's motion — the eye follows the ring to the next thing. But a
   * transition that outlives the move would also smear ordinary scroll tracking, so
   * it is armed on a step change and disarmed once the new step has landed.
   */
  const [gliding, setGliding] = useState(false)

  // Direction of travel — an unreachable step is skipped the way the user was going.
  const dirRef = useRef<1 | -1>(1)
  // `pathname` read without re-arming the per-step effect (navigation is its job).
  const pathRef = useRef(pathname)
  pathRef.current = pathname

  const step: TourStep | undefined = plan[index]
  const last = isLast(index, plan.length)

  /**
   * Plan ONCE per opening: the steps whose anchors are reachable from here. Kept off
   * `steps`/`pathname` on purpose — re-planning mid-run would drop the very steps we
   * are navigating toward and renumber the counter under the user.
   */
  useEffect(() => {
    if (!open) return
    setPlan(planTour(steps, { pathname: pathRef.current, has: (sel) => Boolean(findTarget(sel)) }))
    setIndex(0)
    dirRef.current = 1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const finish = useCallback(() => {
    onFinish?.()
    onClose()
  }, [onFinish, onClose])

  const go = useCallback(
    (dir: 1 | -1) => {
      dirRef.current = dir
      setIndex((i) => {
        if (dir === 1) {
          if (isLast(i, plan.length)) return i
          return nextIndex(i, plan.length)
        }
        return prevIndex(i)
      })
    },
    [plan.length],
  )

  const advance = useCallback(() => {
    if (last) finish()
    else go(1)
  }, [last, finish, go])

  /**
   * Resolve the current step: navigate to its route if we are elsewhere, then wait
   * for its anchor to mount. An anchor that never arrives makes the step SKIP in the
   * direction of travel — the tour keeps moving and never spotlights nothing.
   */
  useEffect(() => {
    if (!open || !step) return
    let alive = true
    let timer = 0
    setPlaced(false)
    setRect(null)

    if (step.route && !sameRoute(step.route, pathRef.current)) router.push(step.route)

    if (!step.target) {
      setRect(null)
      setPlaced(true)
      return
    }

    const deadline = Date.now() + FIND_MS
    const tick = () => {
      if (!alive) return
      const el = findTarget(step.target)
      if (el) {
        reveal(el, step.placement, cardH)
        setRect(rectOf(el))
        setPlaced(true)
        return
      }
      if (Date.now() >= deadline) {
        // Unreachable after a fair wait — keep going rather than point at nothing.
        if (dirRef.current === 1) {
          if (isLast(index, plan.length)) finish()
          else go(1)
        } else if (index === 0) onClose()
        else go(-1)
        return
      }
      timer = window.setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, plan])

  /**
   * Keep the spotlight glued to its target, every frame.
   *
   * A timer cannot do this. The page under the overlay is still live — a wheel, a
   * trackpad flick, a lazy pane finishing its layout — and a poll paints the cutout
   * where the target USED to be, so the ring trails the thing it is supposed to be
   * ringing. A rAF read is exact, and costs one `getBoundingClientRect` per frame
   * while an overlay the user is reading is open. React re-renders only when the rect
   * actually CHANGED, so a still page is free.
   */
  useEffect(() => {
    if (!open || !step?.target || !placed) return
    let frame = 0
    let prev: Rect | null = rect
    const same = (a: Rect | null, b: Rect | null): boolean =>
      a === b ||
      Boolean(a && b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)
    const loop = () => {
      const el = findTarget(step.target)
      const next = el ? rectOf(el) : null
      if (!same(prev, next)) {
        prev = next
        setRect(next)
      }
      frame = window.requestAnimationFrame(loop)
    }
    frame = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, placed])

  // Arm the glide on a step change; disarm it once that step has landed.
  useEffect(() => {
    if (!open) return
    setGliding(true)
    if (!placed) return
    const t = window.setTimeout(() => setGliding(false), 280)
    return () => window.clearTimeout(t)
  }, [open, index, placed])

  // Escape skips the whole tour; the arrows walk it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        advance()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, advance, go])

  if (!open || !step || typeof document === 'undefined') return null

  // Reduced motion: no glide at all — the ring is simply already there.
  const ease =
    reduced || !gliding
      ? undefined
      : 'top 240ms cubic-bezier(0.16,1,0.3,1), left 240ms cubic-bezier(0.16,1,0.3,1), width 240ms cubic-bezier(0.16,1,0.3,1), height 240ms cubic-bezier(0.16,1,0.3,1)'

  const spotlight: CSSProperties | null = rect
    ? {
        position: 'fixed',
        top: rect.top - 6,
        left: rect.left - 6,
        width: rect.width + 12,
        height: rect.height + 12,
        borderRadius: 10,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
        border: '2px solid rgba(255,255,255,0.92)',
        pointerEvents: 'none',
        zIndex: Z.modal,
        transition: ease,
      }
    : null

  return createPortal(
    <>
      {/* Full-screen click-catcher — a backdrop click skips. Dims itself only when
          there is no spotlight (the spotlight's box-shadow provides the dim otherwise). */}
      <YStack
        onPress={onClose}
        data-tour-overlay="backdrop"
        className={reduced ? undefined : 'hz-scrim-in'}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: Z.modal,
          background: rect ? 'transparent' : 'rgba(0,0,0,0.62)',
        }}
      />

      {/* Spotlight cutout around the target (visual only). */}
      {spotlight ? (
        <YStack
          data-tour-overlay="spotlight"
          className={reduced ? undefined : 'hz-scrim-in'}
          style={spotlight}
        />
      ) : null}

      {/* Coach-mark — a sibling of the click-catcher (not nested), so clicks on it
          never reach the backdrop and never skip. */}
      {/* NOT `paper`. That surface is `.glass` — a 72%-opaque ground with a backdrop
          blur — which is right for a menu floating over a LIVE page, where seeing
          through it says the page is still there. Here the page is deliberately
          scrimmed to 62% black, and a translucent card on top of that renders its own
          text over whatever it is pointing at (measured: the mode labels read
          straight through the copy). Same elevation ladder, opaque ground. */}
      <Card
        className={`hz-paper${reduced ? '' : ' hz-menu-in'}`}
        bg="$color1"
        borderWidth={1}
        borderColor="$borderColor"
        rounded="$5"
        data-tour-overlay="card"
        data-tour-step={step.id}
        p="$4"
        gap="$3"
        role="dialog"
        aria-label={step.title}
        ref={(el: unknown) => {
          const node = el as { offsetHeight?: number } | null
          if (node?.offsetHeight && node.offsetHeight !== cardH) setCardH(node.offsetHeight)
        }}
        style={{ ...tooltipStyle(rect, step.placement, cardH), ...(ease ? { transition: ease } : null) }}
      >
        <XStack items="flex-start" justify="space-between" gap="$2">
          <Text fontSize="$5" fontWeight="800" color="$color12" flex={1} minW={0}>
            {step.title}
          </Text>
          <Button size="$2" chromeless circular icon={<X size={16} />} onPress={onClose} aria-label="Close tour" />
        </XStack>

        <Text fontSize="$3" color="$color11">
          {step.body}
        </Text>

        <Dots index={index} total={plan.length} />

        <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
          <Text fontSize="$1" color="$color10" fontWeight="600">
            Step {index + 1} of {plan.length}
          </Text>
          <XStack gap="$2" items="center">
            <Button size="$2" chromeless onPress={onClose}>
              Skip
            </Button>
            {index > 0 ? (
              <Button size="$2" icon={<ArrowLeft size={14} />} onPress={() => go(-1)}>
                Back
              </Button>
            ) : null}
            <Button
              size="$2"
              theme="light"
              iconAfter={last ? <Check size={14} /> : <ArrowRight size={14} />}
              onPress={advance}
            >
              {last ? 'Done' : 'Next'}
            </Button>
          </XStack>
        </XStack>
      </Card>
    </>,
    document.body,
  )
}
