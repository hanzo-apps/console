'use client'

/**
 * RailwayDeploy — the animated deployment pipeline. A horizontal "railway line" with
 * four stations (Queued → Building → Deploying → Live): completed stations fill in with
 * a check, the current station pulses, the active leg shows a smooth flowing gradient,
 * and a failure turns the reached station red. It reads the REAL app status (polls
 * `PaasApi.getApp` via the shared `usePoll`) and animates AS THE DEPLOY PROGRESSES —
 * never a decorative/fake track. Reduced motion → a static, filled progress line.
 *
 * Two modes, one component:
 *  - self-driving (given `projectSlug` + `appSlug`): seeds from `status`, then polls the
 *    live status until terminal (live/error) and animates each transition;
 *  - controlled (no slugs): renders the pipeline from the `status` prop (e.g. a finished
 *    app shows a fully-filled line), re-syncing when the prop changes.
 *
 * All rendering derives from the pure `railway.ts` model (unit-tested); this file is the
 * thin SVG/rAF shell.
 */
import { useEffect, useRef, useState } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'

import { PaasApi } from '~/lib/api/paas'
import { useContainerWidth } from '~/components/ui/Charts'
import { usePoll, useReducedMotion } from '~/components/products/overview/living/hooks'
import {
  isTerminalPhase,
  railwayModel,
  railwayPhase,
  stageIndex,
  type RailwayModel,
  type RailwayPhase,
  type StationState,
} from './railway'

// Monochrome by default; only the genuine deploy states carry a hue (live → green,
// errored → red — design --state-success / --state-error). In-progress = neutral.
const ACCENT = '#D4D4D4' // --neutral-300
const GREEN = '#22c55e' // --state-success
const RED = '#ef4444' // --state-error
const MUTED = 'rgba(160,160,160,0.28)'

export interface RailwayDeployProps {
  /** When both slugs are set, the component polls the live status and animates. */
  projectSlug?: string
  appSlug?: string
  /** Seed / controlled status (an app/deployment status string). */
  status?: string
  /** Poll interval in ms while non-terminal (floored at 1s). Default 2500. */
  pollMs?: number
  /** Called once when the pipeline reaches Live. */
  onLive?: () => void
  /** Called on every phase transition (for a parent to react). */
  onPhase?: (phase: RailwayPhase) => void
}

export function RailwayDeploy({ projectSlug, appSlug, status: statusProp, pollMs = 2500, onLive, onPhase }: RailwayDeployProps) {
  const reduced = useReducedMotion()
  const selfDriving = Boolean(projectSlug && appSlug)

  const [status, setStatus] = useState<string | undefined>(statusProp)
  const [furthest, setFurthest] = useState<number>(stageIndex(railwayPhase(statusProp)))

  // Keep the latest callbacks in refs so the effects don't re-run when a parent
  // passes a fresh closure each render.
  const onLiveRef = useRef(onLive)
  onLiveRef.current = onLive
  const onPhaseRef = useRef(onPhase)
  onPhaseRef.current = onPhase
  const liveNotified = useRef(false)

  const model = railwayModel(status, furthest)
  const terminal = isTerminalPhase(model.phase)
  const canPoll = selfDriving && !terminal && model.phase !== 'idle'
  const { tick } = usePoll(canPoll ? Math.max(1000, pollMs) : 0)

  // Controlled mode: mirror the prop (parent is the source of truth).
  useEffect(() => {
    if (!selfDriving) setStatus(statusProp)
  }, [selfDriving, statusProp])

  // Self-driving: read the REAL live status. Keep the last-known value on a transient
  // error so a blip never blanks the pipeline.
  useEffect(() => {
    if (!canPoll) return
    let cancelled = false
    void PaasApi.getApp(projectSlug as string, appSlug as string)
      .then((app) => {
        if (!cancelled) setStatus(app.status ?? app.phase)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tick, canPoll, projectSlug, appSlug])

  // Track the furthest station actually observed (monotonic → honest error placement).
  useEffect(() => {
    const idx = stageIndex(railwayPhase(status))
    setFurthest((f) => (idx > f ? idx : f))
  }, [status])

  // Notify parent of phase changes + reaching Live (once).
  useEffect(() => {
    onPhaseRef.current?.(model.phase)
  }, [model.phase])
  useEffect(() => {
    if (model.live && !liveNotified.current) {
      liveNotified.current = true
      onLiveRef.current?.()
    } else if (!model.live) {
      liveNotified.current = false
    }
  }, [model.live])

  const tone = model.errored ? RED : model.live ? GREEN : ACCENT

  return (
    <YStack gap="$3" aria-label={`Deployment: ${model.label}`}>
      <XStack items="center" gap="$2">
        <YStack
          width={9}
          height={9}
          rounded="$10"
          style={{ backgroundColor: tone }}
          className={!reduced && model.inProgress ? 'hz-rail-dot' : undefined}
        />
        <Text fontSize="$3" fontWeight="700" color="$color12">
          {model.label}
        </Text>
      </XStack>
      <RailwayTrack model={model} reduced={reduced} tone={tone} />
    </YStack>
  )
}

// ── The SVG track + aligned labels ───────────────────────────────────────────

function RailwayTrack({ model, reduced, tone }: { model: RailwayModel; reduced: boolean; tone: string }) {
  const { ref, w } = useContainerWidth()
  const n = model.stations.length
  const H = 60
  const padX = 24
  const trackY = 28
  const usable = Math.max(1, w - padX * 2)
  const x = (i: number) => padX + (n <= 1 ? 0 : (i / (n - 1)) * usable)

  const active = model.activeIndex
  const fillTo = active < 0 ? x(0) : x(active)
  const flowing = !reduced && model.inProgress && active >= 0 && active < n - 1
  const flowStart = x(Math.max(0, active))
  const flowEnd = x(Math.min(active + 1, n - 1))

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {w > 0 ? (
        <>
          <svg width={w} height={H} style={{ display: 'block', overflow: 'visible' }} role="presentation">
            <defs>
              <linearGradient id="hz-rail-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={tone} stopOpacity="0.15" />
                <stop offset="50%" stopColor={tone} stopOpacity="1" />
                <stop offset="100%" stopColor={tone} stopOpacity="0.15" />
              </linearGradient>
            </defs>

            {/* base track */}
            <line x1={x(0)} y1={trackY} x2={x(n - 1)} y2={trackY} stroke={MUTED} strokeWidth={4} strokeLinecap="round" />

            {/* filled (completed) track */}
            {fillTo > x(0) ? (
              <line x1={x(0)} y1={trackY} x2={fillTo} y2={trackY} stroke={tone} strokeWidth={4} strokeLinecap="round" />
            ) : null}

            {/* flowing "train" on the active leg */}
            {flowing ? (
              <line
                x1={flowStart}
                y1={trackY}
                x2={flowEnd}
                y2={trackY}
                stroke="url(#hz-rail-grad)"
                strokeWidth={4}
                strokeLinecap="round"
                className="hz-rail-flow"
              />
            ) : null}

            {/* stations */}
            {model.stations.map((st, i) => (
              <Station key={st.name} cx={x(i)} cy={trackY} state={st.state} tone={tone} reduced={reduced} />
            ))}
          </svg>

          {/* labels aligned under each station */}
          <div style={{ position: 'relative', width: w, height: 30, marginTop: 2 }}>
            {model.stations.map((st, i) => (
              <div
                key={st.name}
                style={{
                  position: 'absolute',
                  left: x(i),
                  transform: i === 0 ? 'translateX(0)' : i === n - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                  textAlign: i === 0 ? 'left' : i === n - 1 ? 'right' : 'center',
                  maxWidth: 110,
                }}
              >
                <StationLabel name={st.name} state={st.state} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ height: H + 30 }} />
      )}
    </div>
  )
}

function StationLabel({ name, state }: { name: string; state: StationState }) {
  const sub =
    state === 'active' ? 'in progress' : state === 'error' ? 'failed' : state === 'done' ? 'done' : ''
  return (
    <YStack gap="$0.5">
      <Text
        fontSize="$1"
        fontWeight={state === 'active' || state === 'error' ? '800' : '600'}
        color={state === 'pending' ? '$color9' : '$color12'}
        numberOfLines={1}
      >
        {name}
      </Text>
      <Text fontSize="$1" style={state === 'error' ? { color: RED } : undefined} color={state === 'error' ? undefined : '$color10'}>
        {sub || ' '}
      </Text>
    </YStack>
  )
}

function Station({ cx, cy, state, tone, reduced }: { cx: number; cy: number; state: StationState; tone: string; reduced: boolean }) {
  const r = 11
  if (state === 'done') {
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={tone} />
        <path
          d={`M${cx - 4.5},${cy + 0.5} L${cx - 1.5},${cy + 3.5} L${cx + 4.5},${cy - 3.5}`}
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    )
  }
  if (state === 'error') {
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={RED} />
        <path d={`M${cx - 3.5},${cy - 3.5} L${cx + 3.5},${cy + 3.5} M${cx + 3.5},${cy - 3.5} L${cx - 3.5},${cy + 3.5}`} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
      </g>
    )
  }
  if (state === 'active') {
    return (
      <g>
        {!reduced ? <circle cx={cx} cy={cy} r={r} fill={tone} className="hz-rail-pulse" /> : null}
        <circle cx={cx} cy={cy} r={r} fill="var(--color2, #14161a)" stroke={tone} strokeWidth={3} />
        <circle cx={cx} cy={cy} r={4} fill={tone} />
      </g>
    )
  }
  // pending
  return <circle cx={cx} cy={cy} r={r} fill="var(--color2, #14161a)" stroke={MUTED} strokeWidth={2} />
}
