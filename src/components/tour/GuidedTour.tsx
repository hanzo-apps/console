'use client'

/**
 * GuidedTour — a fully NATIVE, self-contained guided-tour overlay. Zero external
 * scripts (no Appcues/driver.js), zero new deps — so it works inside the go:embed
 * static console and under any CSP. It spotlights a step's `data-tour` target with a
 * box-shadow cutout and floats a tooltip beside it; a step with no target (or whose
 * target isn't on the page / is hidden) renders centered. Escape or a backdrop click
 * skips; the last step finishes.
 *
 * @hanzo/gui v5 shorthands for chrome; arbitrary fixed/absolute positioning goes
 * through `style` (the Charts.tsx convention — Tamagui bg/color props take tokens,
 * numeric layout math takes `style`). SSR-safe: renders null when closed or on the
 * server.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, ArrowRight, Check, X } from '@hanzogui/lucide-icons-2'

import { isLast, nextIndex, prevIndex, type TourStep } from '~/lib/tour/steps'
import { Z } from '~/lib/z'

type Rect = { top: number; left: number; width: number; height: number }

const CARD_W = 340
const GAP = 12

/** Read the current step's target rect, or null (no target / not found / hidden). */
function readRect(target?: string): Rect | null {
  if (!target || typeof document === 'undefined') return null
  const el = document.querySelector(target)
  if (!el) return null
  const r = el.getBoundingClientRect()
  // A zero-size box = a hidden anchor (e.g. the desktop sidebar on a phone) → center.
  if (r.width < 1 || r.height < 1) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

/** Clamp a value into [min, max]. */
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, max))

/** Fixed-position style for the tooltip card given the target rect + placement. */
function tooltipStyle(rect: Rect | null, placement: TourStep['placement']): CSSProperties {
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  if (!rect || placement === 'center' || !placement) {
    return { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: CARD_W, maxWidth: '92vw', zIndex: Z.popover }
  }
  const base: CSSProperties = { position: 'fixed', width: CARD_W, maxWidth: '92vw', zIndex: Z.popover }
  const leftClamped = clamp(rect.left, GAP, Math.max(GAP, vw - CARD_W - GAP))
  switch (placement) {
    case 'bottom':
      return { ...base, top: clamp(rect.top + rect.height + GAP, GAP, vh - GAP), left: leftClamped }
    case 'top':
      return { ...base, bottom: clamp(vh - rect.top + GAP, GAP, vh - GAP), left: leftClamped }
    case 'right':
      return { ...base, top: clamp(rect.top, GAP, vh - GAP), left: clamp(rect.left + rect.width + GAP, GAP, Math.max(GAP, vw - CARD_W - GAP)) }
    case 'left':
      return { ...base, top: clamp(rect.top, GAP, vh - GAP), right: clamp(vw - rect.left + GAP, GAP, vw - GAP) }
    default:
      return { ...base, top: clamp(rect.top + rect.height + GAP, GAP, vh - GAP), left: leftClamped }
  }
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
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  const step = steps[index]
  const last = isLast(index, steps.length)

  // Reset to the first step whenever the tour (re)opens.
  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  // Track the current step's target rect; recompute on resize/scroll.
  useEffect(() => {
    if (!open || !step) return
    const update = () => setRect(readRect(step.target))
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, step])

  const finish = useCallback(() => {
    onFinish?.()
    onClose()
  }, [onFinish, onClose])

  const advance = useCallback(() => {
    if (last) finish()
    else setIndex((i) => nextIndex(i, steps.length))
  }, [last, finish, steps.length])

  // Escape skips the whole tour.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !step || typeof document === 'undefined') return null

  const spotlight: CSSProperties | null = rect
    ? {
        position: 'fixed',
        top: rect.top - 6,
        left: rect.left - 6,
        width: rect.width + 12,
        height: rect.height + 12,
        borderRadius: 10,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
        border: '2px solid rgba(255,255,255,0.9)',
        pointerEvents: 'none',
        zIndex: Z.modal,
      }
    : null

  return (
    <>
      {/* Full-screen click-catcher — a backdrop click skips. Dims itself only when
          there is no spotlight (the spotlight's box-shadow provides the dim otherwise). */}
      <YStack
        onPress={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: Z.modal,
          background: rect ? 'transparent' : 'rgba(0,0,0,0.55)',
        }}
      />

      {/* Spotlight cutout around the target (visual only). */}
      {spotlight ? <YStack style={spotlight} /> : null}

      {/* Tooltip card — a sibling of the click-catcher (not nested), so clicks on it
          never reach the backdrop and never skip. */}
      <Card borderWidth={1} borderColor="$borderColor" bg="$color1" p="$4" gap="$3" style={tooltipStyle(rect, step.placement)}>
        <XStack items="center" justify="space-between" gap="$2">
          <Text fontSize="$5" fontWeight="800" color="$color12">
            {step.title}
          </Text>
          <Button size="$2" chromeless circular icon={<X size={16} />} onPress={onClose} aria-label="Skip tour" />
        </XStack>

        <Text fontSize="$3" color="$color11">
          {step.body}
        </Text>

        <XStack items="center" justify="space-between" gap="$2" pt="$1">
          <Text fontSize="$1" color="$color10">
            Step {index + 1} of {steps.length}
          </Text>
          <XStack gap="$2" items="center">
            <Button size="$2" chromeless onPress={onClose}>
              Skip
            </Button>
            {index > 0 ? (
              <Button size="$2" icon={<ArrowLeft size={14} />} onPress={() => setIndex((i) => prevIndex(i))}>
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
    </>
  )
}

