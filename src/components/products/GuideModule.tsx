'use client'

/**
 * Guide — the Business AI Guide, an org-level launch checklist over the REAL cloud
 * `/v1/guide` surface (cloud `clients/guide`). A machine-readable curriculum drives
 * the steps; per-org progress tracks a state per step; and the Business AI can DO a
 * step for you, streaming each action live.
 *
 * One clean screen: a launch-progress bar with Complete / Total / Next tiles, a
 * focused "next step" card (why · how-on-Hanzo · done-when + Mark done / Skip / a
 * primary "Do it for me"), and the full step list with a state chip, a blocked/lock
 * hint, and inline actions per non-terminal row. "Do it for me" opens a panel and
 * streams the agent's plan → draft → action → result → state events (SSE), falling
 * back to the non-streaming JSON `do` if the backend can't stream. Every value is
 * real or an honest empty/`—`; states are loading / BackendStateCard / empty — an
 * `error` event stays an error, success is never fabricated. Org-scoped SERVER-SIDE
 * (the `/v1` bearer proxy); no credential in the browser.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Compass,
  ListChecks,
  Lock,
  RefreshCw,
  Rocket,
  SkipForward,
  Sparkles,
  Target,
  TriangleAlert,
  Wand2,
  X,
} from '@hanzogui/lucide-icons-2'

import {
  GuideApi,
  streamDo,
  type GuideEvent,
  type GuideOverview,
  type GuideStep,
  type StepState,
} from '~/lib/api/guide'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { EmptyState } from '~/components/ui/EmptyState'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import {
  blockedLabel,
  clampPercent,
  currentStep,
  eventLabel,
  isComplete,
  isTerminal,
  progressCaption,
  stateLabel,
  stateTone,
} from './guide/logic'
import { toneColor } from '~/components/ui/tone'
import { toneVar } from '~/components/ui/tone-var'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

export function GuideModule({ params }: { params: Record<string, string> }) {
  const [state, setState] = useState<Async<GuideOverview>>({ phase: 'loading' })
  // A per-step transition (Mark done / Skip) in flight — disables just that row.
  const [busy, setBusy] = useState<string | null>(null)
  // A non-blanking inline notice for an action failure (a 409/etc on a single
  // step must never wipe the whole page the way an initial-load error does).
  const [actionError, setActionError] = useState<string | null>(null)

  // "Do it for me" streaming panel state.
  const [doStep, setDoStep] = useState<GuideStep | null>(null)
  const [events, setEvents] = useState<GuideEvent[]>([])
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    GuideApi.overview()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  // Silent refresh — replaces the ready data WITHOUT flipping to a loading blank,
  // so a post-stream / post-action refresh never tears down the panel or the list.
  const refresh = useCallback(() => {
    GuideApi.overview()
      .then((o) => setState({ phase: 'ready', data: o }))
      .catch(() => {
        /* keep the current view; a transient refresh error must not blank it */
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Mark done / Skip return the SAME overview shape — apply it directly (no reload).
  const transition = useCallback((id: string, fn: (id: string) => Promise<GuideOverview>) => {
    setBusy(id)
    setActionError(null)
    fn(id)
      .then((o) => setState({ phase: 'ready', data: o }))
      .catch((e) => setActionError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null))
  }, [])
  const onMarkDone = useCallback((id: string) => transition(id, GuideApi.markDone), [transition])
  const onSkip = useCallback((id: string) => transition(id, GuideApi.skip), [transition])

  const closeDo = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
    setDoStep(null)
    setEvents([])
  }, [])

  // "Do it for me" — stream the Business AI's actions, honestly.
  const onDo = useCallback(
    async (step: GuideStep) => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setDoStep(step)
      setEvents([])
      setStreaming(true)
      setActionError(null)

      let received = 0
      const onEvent = (e: GuideEvent) => {
        received += 1
        setEvents((prev) => [...prev, e])
      }

      try {
        await streamDo(step.id, onEvent, ctrl.signal)
      } catch (err) {
        if (ctrl.signal.aborted) return
        if (received === 0) {
          // The backend couldn't stream (no SSE / non-2xx before any frame) —
          // fall back to the non-streaming JSON `do` and render its events.
          try {
            const res = await GuideApi.do(step.id)
            for (const e of res.events) onEvent(e)
            if (res.events.length === 0) onEvent({ type: 'state', state: res.state })
          } catch (e2) {
            const msg = e2 instanceof Error ? e2.message : String(e2)
            onEvent({ type: 'error', error: msg })
            setActionError(msg)
          }
        } else {
          // A failure mid-stream, after real frames — surface it, never fabricate success.
          onEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) })
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setStreaming(false)
          refresh() // reflect the new state/progress the agent produced
        }
      }
    },
    [refresh],
  )

  const streamingId = streaming && doStep ? doStep.id : null

  return (
    <YStack gap="$3">
      <PageHeader
        title="Guide"
        subtitle="Launch your business on Hanzo — the Business AI can do each step for you."
        actions={
          <Button
            size="$3"
            icon={<RefreshCw size={15} />}
            onPress={load}
            disabled={state.phase === 'loading'}
          >
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' && <Text color="$color10">Loading your launch guide…</Text>}
      {state.phase === 'error' && (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/guide" />
      )}
      {state.phase === 'ready' && (
        <>
          {actionError ? (
            <Card p="$3" borderWidth={1} borderColor="$borderColor" bg="$color2">
              <XStack items="center" justify="space-between" gap="$2">
                <XStack items="center" gap="$2" flex={1} minW={0}>
                  <TriangleAlert size={15} color={toneColor('critical')} />
                  <Text fontSize="$3" color="$color11" flex={1}>
                    {actionError}
                  </Text>
                </XStack>
                <Button size="$2" chromeless icon={<X size={14} />} onPress={() => setActionError(null)}>
                  Dismiss
                </Button>
              </XStack>
            </Card>
          ) : null}

          {doStep ? (
            <DoPanel step={doStep} events={events} streaming={streaming} onClose={closeDo} />
          ) : null}

          <GuideReady
            data={state.data}
            focusId={params.tab || undefined}
            busy={busy}
            streamingId={streamingId}
            onMarkDone={onMarkDone}
            onSkip={onSkip}
            onDo={onDo}
          />
        </>
      )}
    </YStack>
  )
}

// ── Ready view ────────────────────────────────────────────────────────────────

function GuideReady({
  data,
  focusId,
  busy,
  streamingId,
  onMarkDone,
  onSkip,
  onDo,
}: {
  data: GuideOverview
  focusId?: string
  busy: string | null
  streamingId: string | null
  onMarkDone: (id: string) => void
  onSkip: (id: string) => void
  onDo: (step: GuideStep) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => (focusId ? new Set([focusId]) : new Set()))
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const pct = clampPercent(data.progress.percent)
  const cur = currentStep(data)
  const done = isComplete(data)

  return (
    <YStack gap="$3">
      {/* Launch progress bar */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack justify="space-between" items="center" gap="$2" flexWrap="wrap">
          <Text fontSize="$4" fontWeight="700" color="$color12">
            Launch progress
          </Text>
          <Text fontSize="$3" color="$color11">
            {progressCaption(data)} · {pct}%
          </Text>
        </XStack>
        <YStack bg="$color4" rounded="$4" height={8} width="100%" overflow="hidden">
          <YStack bg={toneColor('positive')} height={8} rounded="$4" width={`${pct}%`} />
        </YStack>
      </Card>

      {/* Real stat tiles */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard
          icon={<CircleCheck size={16} color={toneColor('positive')} />}
          label="Complete"
          value={String(data.progress.done)}
          caption="steps done or skipped"
        />
        <MetricCard
          icon={<ListChecks size={16} color={toneColor('muted')} />}
          label="Total"
          value={String(data.progress.total)}
          caption="steps in your guide"
        />
        <MetricCard
          icon={<Target size={16} color="#D4D4D4" />}
          label="Next"
          value={cur ? cur.title : done ? 'Launched' : '—'}
          caption={done ? 'nothing left to do' : 'what to tackle now'}
        />
      </XStack>

      {/* Current step OR the celebratory launched state */}
      {done ? (
        <EmptyState
          icon={Rocket}
          title="You're launched"
          description="Every step is done. Your business is live on Hanzo — revisit any step below to keep iterating."
        />
      ) : cur ? (
        <CurrentStepCard
          step={cur}
          overview={data}
          busy={busy}
          streamingId={streamingId}
          onMarkDone={onMarkDone}
          onSkip={onSkip}
          onDo={onDo}
        />
      ) : null}

      {/* All steps */}
      <Card p="$0" borderWidth={1} borderColor="$borderColor" overflow="hidden">
        <XStack
          px="$4"
          py="$3"
          borderBottomWidth={1}
          borderColor="$borderColor"
          items="center"
          justify="space-between"
          gap="$2"
        >
          <Text fontSize="$4" fontWeight="700" color="$color12">
            All steps
          </Text>
          <Text fontSize="$2" color="$color10">
            {data.steps.length} total
          </Text>
        </XStack>
        {data.steps.length === 0 ? (
          <YStack p="$5" items="center" gap="$2">
            <Compass size={22} color={toneColor('muted')} />
            <Text fontSize="$3" color="$color11">
              No steps in your guide yet
            </Text>
            <Text fontSize="$2" color="$color10">
              A curriculum will appear here once it is configured.
            </Text>
          </YStack>
        ) : (
          <YStack>
            {data.steps.map((s) => (
              <StepRow
                key={s.id}
                step={s}
                overview={data}
                busy={busy}
                streamingId={streamingId}
                expanded={expanded.has(s.id)}
                onToggle={() => toggle(s.id)}
                onMarkDone={onMarkDone}
                onSkip={onSkip}
                onDo={onDo}
              />
            ))}
          </YStack>
        )}
      </Card>
    </YStack>
  )
}

// ── The focused "next step" card ────────────────────────────────────────────────

function CurrentStepCard({
  step,
  overview,
  busy,
  streamingId,
  onMarkDone,
  onSkip,
  onDo,
}: {
  step: GuideStep
  overview: GuideOverview
  busy: string | null
  streamingId: string | null
  onMarkDone: (id: string) => void
  onSkip: (id: string) => void
  onDo: (step: GuideStep) => void
}) {
  const blocked = !step.available
  const active = streamingId === step.id
  const anyStreaming = streamingId != null
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$2" flexWrap="wrap">
        <XStack items="center" gap="$1.5" px="$2" py="$1" rounded="$10" bg="$color3">
          <Target size={12} color="#D4D4D4" />
          <Text fontSize="$1" fontWeight="600" color="$color11">
            Next step
          </Text>
        </XStack>
        <StateChip state={step.state} />
      </XStack>

      <Text fontSize="$6" fontWeight="600" color="$color12" letterSpacing={-0.3}>
        {step.title}
      </Text>
      {step.why ? (
        <Text fontSize="$3" color="$color11">
          {step.why}
        </Text>
      ) : null}
      {step.how ? <Field label="How on Hanzo" value={step.how} /> : null}
      {step.done ? <Field label="Done when" value={step.done} /> : null}

      {blocked ? (
        <XStack items="center" gap="$2">
          <Lock size={14} color={toneColor('muted')} />
          <Text fontSize="$2" color="$color10">
            {blockedLabel(step, overview) || 'Finish the prior steps first.'}
          </Text>
        </XStack>
      ) : null}

      <XStack gap="$2" items="center" flexWrap="wrap" pt="$1">
        {step.automatable ? (
          <PrimaryButton
            icon={<Wand2 size={15} />}
            onPress={() => onDo(step)}
            disabled={blocked || anyStreaming}
          >
            {active ? 'Working…' : 'Do it for me'}
          </PrimaryButton>
        ) : null}
        <Button
          size="$3"
          icon={<Check size={15} />}
          onPress={() => onMarkDone(step.id)}
          disabled={blocked || busy === step.id}
        >
          Mark done
        </Button>
        <Button
          size="$3"
          icon={<SkipForward size={15} />}
          onPress={() => onSkip(step.id)}
          disabled={busy === step.id}
        >
          Skip
        </Button>
      </XStack>
    </Card>
  )
}

// ── One row in the step list ────────────────────────────────────────────────────

function StepRow({
  step,
  overview,
  busy,
  streamingId,
  expanded,
  onToggle,
  onMarkDone,
  onSkip,
  onDo,
}: {
  step: GuideStep
  overview: GuideOverview
  busy: string | null
  streamingId: string | null
  expanded: boolean
  onToggle: () => void
  onMarkDone: (id: string) => void
  onSkip: (id: string) => void
  onDo: (step: GuideStep) => void
}) {
  const terminal = isTerminal(step.state)
  const blocked = !step.available
  const active = streamingId === step.id
  const anyStreaming = streamingId != null
  const canExpand = Boolean(step.why || step.how || step.done)
  return (
    <YStack borderBottomWidth={1} borderColor="$borderColor">
      <XStack px="$4" py="$3" gap="$3" items="center" justify="space-between" flexWrap="wrap">
        <XStack
          items="center"
          gap="$3"
          flex={1}
          minW={220}
          cursor={canExpand ? 'pointer' : undefined}
          onPress={canExpand ? onToggle : undefined}
        >
          <StateChip state={step.state} />
          <YStack gap="$1" flex={1} minW={0}>
            <XStack items="center" gap="$2" flexWrap="wrap">
              <Text fontSize="$3" fontWeight="600" color="$color12">
                {step.title}
              </Text>
              {blocked ? (
                <XStack items="center" gap="$1">
                  <Lock size={11} color={toneColor('muted')} />
                  <Text fontSize="$1" color="$color10">
                    {blockedLabel(step, overview) || 'Blocked'}
                  </Text>
                </XStack>
              ) : null}
              {step.automatable && !terminal ? (
                <XStack items="center" gap="$1">
                  <Sparkles size={11} color="#D4D4D4" />
                  <Text fontSize="$1" color="$color10">
                    AI-ready
                  </Text>
                </XStack>
              ) : null}
            </XStack>
            {step.why ? (
              <Text fontSize="$2" color="$color10" numberOfLines={expanded ? undefined : 1}>
                {step.why}
              </Text>
            ) : null}
          </YStack>
          {canExpand ? (
            expanded ? (
              <ChevronDown size={15} color={toneColor('muted')} />
            ) : (
              <ChevronRight size={15} color={toneColor('muted')} />
            )
          ) : null}
        </XStack>

        {!terminal ? (
          <XStack items="center" gap="$2" flexWrap="wrap">
            {step.automatable ? (
              <Button
                size="$2"
                icon={<Wand2 size={13} />}
                onPress={() => onDo(step)}
                disabled={blocked || anyStreaming}
              >
                {active ? 'Working…' : 'Do it for me'}
              </Button>
            ) : null}
            <Button
              size="$2"
              icon={<Check size={13} />}
              onPress={() => onMarkDone(step.id)}
              disabled={blocked || busy === step.id}
            >
              Mark done
            </Button>
            <Button
              size="$2"
              icon={<SkipForward size={13} />}
              onPress={() => onSkip(step.id)}
              disabled={busy === step.id}
            >
              Skip
            </Button>
          </XStack>
        ) : null}
      </XStack>

      {expanded ? (
        <YStack px="$4" pb="$3" gap="$2">
          {step.how ? <Field label="How on Hanzo" value={step.how} /> : null}
          {step.done ? <Field label="Done when" value={step.done} /> : null}
        </YStack>
      ) : null}
    </YStack>
  )
}

// ── The live "Do it for me" streaming panel ─────────────────────────────────────

function DoPanel({
  step,
  events,
  streaming,
  onClose,
}: {
  step: GuideStep
  events: GuideEvent[]
  streaming: boolean
  onClose: () => void
}) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color2">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <XStack items="center" gap="$2" flex={1} minW={0}>
          <Wand2 size={16} color="#D4D4D4" />
          <Text fontSize="$4" fontWeight="700" color="$color12" numberOfLines={1}>
            Business AI · {step.title}
          </Text>
        </XStack>
        <Button size="$2" chromeless icon={<X size={15} />} onPress={onClose}>
          Close
        </Button>
      </XStack>

      {streaming ? (
        <XStack items="center" gap="$2">
          <Spinner size="small" />
          <Text fontSize="$3" color="$color11">
            Working…
          </Text>
        </XStack>
      ) : null}

      {events.length === 0 && !streaming ? (
        <Text fontSize="$3" color="$color10">
          The Business AI returned no actions for this step.
        </Text>
      ) : (
        <YStack gap="$2">
          {events.map((e, i) => (
            <EventRow key={i} e={e} />
          ))}
        </YStack>
      )}
    </Card>
  )
}

function EventRow({ e }: { e: GuideEvent }) {
  const err = e.type === 'error'
  const tone = toneVar(err ? 'critical' : e.type === 'end' || e.type === 'state' ? 'positive' : 'muted')
  return (
    <XStack items="flex-start" gap="$2" py="$1">
      <YStack width={7} height={7} rounded="$2" mt="$1.5" bg={tone as never} />
      <YStack gap="$1" flex={1} minW={0}>
        <Text fontSize="$2" fontWeight="600" color={err ? toneColor('critical') : '$color12'}>
          {eventLabel(e)}
        </Text>
        {e.text ? (
          <Text fontSize="$2" color="$color11">
            {e.text}
          </Text>
        ) : null}
        {e.error ? (
          <Text fontSize="$2" color={toneColor('critical')}>
            {e.error}
          </Text>
        ) : null}
      </YStack>
    </XStack>
  )
}

// ── Small shared pieces ─────────────────────────────────────────────────────────

function StateChip({ state }: { state: StepState }) {
  return (
    <XStack items="center" gap="$1.5" px="$2" py="$1" rounded="$10" borderWidth={1} borderColor="$borderColor">
      <YStack width={8} height={8} rounded="$2" bg={stateTone(state) as never} />
      <Text fontSize="$1" fontWeight="600" color="$color11">
        {stateLabel(state)}
      </Text>
    </XStack>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <YStack gap="$1">
      <Text fontSize="$1" fontWeight="700" color="$color10" letterSpacing={0.4}>
        {label}
      </Text>
      <Text fontSize="$3" color="$color11">
        {value}
      </Text>
    </YStack>
  )
}
