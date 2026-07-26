'use client'

/**
 * Mission Control — a MOBILE-FIRST, swipeable "terminal-per-agent" board over the
 * live agent-session plane (`/v1/agents/sessions`). One swipe card per session: a
 * live transcript (the session's event stream, tailed over SSE), a status pill, the
 * machine/repo/agent it runs on, and the plane's control ops (pause/resume/stop/
 * message). A second view — Devices — is the run-targets roster (#48): the linked
 * computers/GPUs a session can be dispatched to, unioned with the hosts live sessions
 * report, showing which sessions run where.
 *
 * Everything is REAL or honest: org isolation is server-side (the plane resolves the
 * org from the bearer owner and fail-closed 403s cross-tenant), and a metric no row
 * carries reads "—". Strictly @hanzo/gui v5 shorthands; responsive down to a phone;
 * thumb-reachable controls; dark-first (themed via the Tamagui CSS vars).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Cpu,
  GitBranch,
  Laptop,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Server,
  Square,
  Terminal,
  Trash2,
} from '@hanzogui/lucide-icons-2'

import {
  MissionControlApi,
  canControl,
  clampIndex,
  deviceRoster,
  eventLine,
  fmtRelative,
  statusTone,
  type Device,
  type NewTarget,
  type Session,
  type SessionEvent,
  type TargetKind,
} from '~/lib/api/mission-control'
import { PageHeader } from '~/components/ui/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { BackendStateCard, classifyBackend } from '~/components/ui/BackendState'
import { FieldRow, FieldText, FieldSelect } from '~/components/ui/Field'
import { SlideOver } from '~/components/ui/SlideOver'
import { useToast } from '~/components/ui/Toast'
import { useLiveSessions, type LiveState } from './mission-control/live'
import { toneColor, toneVar } from '~/components/ui/tone'

// ── status tone palette — the ONE map, as CSS values; the pill's bg is a shade ──
const TONE: Record<ReturnType<typeof statusTone>, { fg: string; bg: string; label: string }> = {
  live: { fg: toneVar('positive'), bg: 'var(--color4)', label: 'Live' },
  paused: { fg: toneVar('warning'), bg: 'var(--color4)', label: 'Paused' },
  ok: { fg: toneVar('muted'), bg: 'var(--color3)', label: 'Done' },
  error: { fg: toneVar('critical'), bg: 'var(--color5)', label: 'Error' },
}

function StatusPill({ status }: { status: Session['status'] }) {
  const t = TONE[statusTone(status)]
  return (
    <XStack items="center" gap="$1.5" px="$2.5" py="$1" rounded="$10" style={{ backgroundColor: t.bg }}>
      <YStack width={7} height={7} rounded="$10" style={{ backgroundColor: t.fg }} />
      <Text fontSize="$1" fontWeight="600" style={{ color: t.fg }}>
        {t.label}
      </Text>
    </XStack>
  )
}

// ── the swipe pager: native CSS scroll-snap (mobile-perfect) + keys + buttons ──
function SwipePager({ slides, onActive }: { slides: React.ReactNode[]; onActive?: (i: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(0)
  const n = slides.length

  useEffect(() => {
    onActive?.(active)
  }, [active, onActive])

  const page = useCallback((dir: number) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' })
  }, [])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    setActive(clampIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)), n))
  }, [n])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowRight') page(1)
      else if (e.key === 'ArrowLeft') page(-1)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [page])

  return (
    <YStack gap="$3">
      <div
        ref={ref}
        onScroll={onScroll}
        style={{
          display: 'flex',
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          gap: 14,
          scrollbarWidth: 'none',
          paddingBottom: 2,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {slides.map((s, i) => (
          <div key={i} style={{ flex: '0 0 100%', scrollSnapAlign: 'center', minWidth: 0 }}>
            {s}
          </div>
        ))}
      </div>

      {/* thumb-reachable pager controls + dots */}
      <XStack items="center" justify="center" gap="$3">
        <Button size="$3" circular chromeless icon={<ChevronLeft size={18} />} onPress={() => page(-1)} disabled={active <= 0} aria-label="Previous session" />
        <XStack items="center" gap="$1.5" flexWrap="wrap" justify="center" maxW={220}>
          {slides.map((_, i) => (
            <YStack key={i} width={i === active ? 20 : 7} height={7} rounded="$10" bg={i === active ? '$color12' : '$color6'} />
          ))}
        </XStack>
        <Button size="$3" circular chromeless icon={<ChevronRight size={18} />} onPress={() => page(1)} disabled={active >= n - 1} aria-label="Next session" />
      </XStack>
      <Text fontSize="$1" color="$color10" text="center">
        {n > 0 ? `${active + 1} of ${n}` : ''}
      </Text>
    </YStack>
  )
}

// ── the live transcript (a terminal): monospace, auto-scrolls to newest ──────
function TerminalView({ events, empty }: { events: SessionEvent[]; empty: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events.length])
  return (
    <div
      ref={ref}
      role="log"
      aria-live="polite"
      style={{
        height: 260,
        overflowY: 'auto',
        background: 'var(--color1)',
        border: '1px solid var(--borderColor)',
        borderRadius: 12,
        padding: '10px 12px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12.5,
        lineHeight: '18px',
        color: 'var(--color11)',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {events.length === 0 ? (
        <span style={{ color: 'var(--color9)' }}>{empty}</span>
      ) : (
        events.map((e) => (
          <div key={e.id} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <span style={{ color: 'var(--color8)' }}>{`${e.seq.toString().padStart(3, '0')} `}</span>
            <span style={{ color: kindColor(e.kind) }}>{`${e.kind}`}</span>
            {e.actor ? <span style={{ color: 'var(--color9)' }}>{` ${e.actor}`}</span> : null}
            <span style={{ color: 'var(--color12)' }}>{`  ${eventLine(e.payload, e.kind)}`}</span>
          </div>
        ))
      )}
    </div>
  )
}

function kindColor(kind: string): string {
  // Monochrome for non-semantic event kinds (design --neutral ladder); only the
  // genuine states carry a WEIGHT off the one tone map, never a hue.
  switch (kind) {
    case 'tool-call':
      return toneVar('neutral')
    case 'spawn':
      return toneVar('muted')
    case 'status':
      return toneVar('warning')
    case 'control':
      return toneVar('critical')
    case 'message':
      return toneVar('positive')
    default:
      return 'var(--color10)'
  }
}

// ── one session card: header + context + terminal + controls ─────────────────
function SessionCard({
  s,
  events,
  onControl,
}: {
  s: Session
  events: SessionEvent[]
  onControl: LiveState['control']
}) {
  const toast = useToast()
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<'' | 'pause' | 'resume' | 'stop' | 'message'>('')
  const steerable = canControl(s.status)

  const run = useCallback(
    async (cmd: 'pause' | 'resume' | 'stop' | 'message', text?: string) => {
      setBusy(cmd)
      try {
        await onControl(s.id, cmd, text)
        if (cmd === 'message') setMsg('')
        toast.success(cmd === 'message' ? 'Message sent' : `Session ${cmd === 'stop' ? 'stopped' : cmd + 'd'}`)
      } catch (e) {
        toast.error('Control failed', e instanceof Error ? e.message : undefined)
      } finally {
        setBusy('')
      }
    },
    [onControl, s.id, toast],
  )

  return (
    <Card p="$4" rounded="$6" gap="$3" maxW={760} self="center" width="100%" borderWidth={1} borderColor="$borderColor" bg="$color1">
      {/* header */}
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <XStack items="center" gap="$2.5" flex={1} minW={0}>
          <StatusPill status={s.status} />
          <YStack minW={0} flex={1}>
            <Text fontSize="$5" fontWeight="700" numberOfLines={1}>
              {s.title || s.agent}
            </Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {s.agent}
              {s.actor ? ` · ${s.actor}` : ''}
            </Text>
          </YStack>
        </XStack>
        <Text fontSize="$1" color="$color9">
          {fmtRelative(s.updatedAt)}
        </Text>
      </XStack>

      {/* execution context — the machine / repo it runs on */}
      <XStack gap="$2" flexWrap="wrap">
        <ContextChip icon={<Monitor size={13} />} value={s.host || '—'} label="machine" />
        <ContextChip icon={<GitBranch size={13} />} value={s.repo || '—'} label="repo" />
        {s.cwd ? <ContextChip icon={<Terminal size={13} />} value={s.cwd} label="cwd" /> : null}
        <ContextChip icon={<Activity size={13} />} value={`${s.events} events`} label="events" />
      </XStack>

      {/* the live terminal */}
      <TerminalView events={events} empty={steerable ? 'Waiting for output…' : 'No recorded output for this session.'} />

      {/* controls */}
      <XStack gap="$2" items="center" flexWrap="wrap">
        {s.status === 'paused' ? (
          <Button size="$3" theme="green" icon={<Play size={15} />} onPress={() => void run('resume')} disabled={!!busy}>
            Resume
          </Button>
        ) : (
          <Button size="$3" icon={<Pause size={15} />} onPress={() => void run('pause')} disabled={!steerable || !!busy}>
            Pause
          </Button>
        )}
        <Button size="$3" theme="red" icon={<Square size={14} />} onPress={() => void run('stop')} disabled={!steerable || !!busy}>
          Stop
        </Button>
        {busy ? <Spinner size="small" color="$color10" /> : null}
      </XStack>

      {/* message the running agent */}
      <XStack gap="$2" items="center">
        <Input
          flex={1}
          value={msg}
          onChangeText={setMsg}
          placeholder={steerable ? 'Message the agent…' : 'Session is finished'}
          disabled={!steerable || busy === 'message'}
          autoCapitalize="none"
          onSubmitEditing={() => msg.trim() && void run('message', msg.trim())}
        />
        <Button
          size="$3"
          theme="light"
          icon={<Send size={15} />}
          onPress={() => msg.trim() && void run('message', msg.trim())}
          disabled={!steerable || !msg.trim() || busy === 'message'}
          aria-label="Send message"
        />
      </XStack>
    </Card>
  )
}

function ContextChip({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <XStack items="center" gap="$1.5" px="$2.5" py="$1" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor" maxW={280}>
      {icon}
      <Text fontSize="$1" color="$color11" numberOfLines={1}>
        {value}
      </Text>
      <Text fontSize="$1" color="$color8">
        {label}
      </Text>
    </XStack>
  )
}

// ── devices / run-targets view ───────────────────────────────────────────────
const KIND_ICON: Record<TargetKind | 'unknown', React.ReactNode> = {
  laptop: <Laptop size={16} />,
  cloud: <Server size={16} />,
  gpu: <Cpu size={16} />,
  cluster: <Boxes size={16} />,
  machine: <Monitor size={16} />,
  unknown: <Monitor size={16} />,
}

function DeviceCard({ d, onRemove, onToggle }: { d: Device; onRemove: (id: string) => void; onToggle: (d: Device) => void }) {
  const online = d.status === 'online' || d.status === 'active'
  return (
    <Card p="$3.5" rounded="$5" gap="$2.5" borderWidth={1} borderColor="$borderColor" bg="$color1">
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$2" flex={1} minW={0}>
          {KIND_ICON[d.kind]}
          <YStack minW={0} flex={1}>
            <Text fontSize="$4" fontWeight="700" numberOfLines={1}>
              {d.label}
            </Text>
            <Text fontSize="$1" color="$color9">
              {d.kind}
              {d.registered ? '' : ' · discovered'}
              {d.capacity ? ` · ${d.capacity}` : ''}
            </Text>
          </YStack>
        </XStack>
        <XStack items="center" gap="$1.5">
          <YStack width={8} height={8} rounded="$10" bg={toneColor(online ? 'positive' : 'muted')} />
          <Text fontSize="$1" color="$color10">
            {d.running} live · {d.sessions.length}
          </Text>
        </XStack>
      </XStack>

      {/* which sessions run here */}
      {d.sessions.length > 0 ? (
        <YStack gap="$1">
          {d.sessions.slice(0, 4).map((s) => (
            <XStack key={s.id} items="center" gap="$2" justify="space-between">
              <XStack items="center" gap="$1.5" flex={1} minW={0}>
                <YStack width={6} height={6} rounded="$10" style={{ backgroundColor: TONE[statusTone(s.status)].fg }} />
                <Text fontSize="$1" color="$color11" numberOfLines={1}>
                  {s.title || s.agent}
                </Text>
              </XStack>
              <Text fontSize="$1" color="$color8">
                {fmtRelative(s.updatedAt)}
              </Text>
            </XStack>
          ))}
          {d.sessions.length > 4 ? (
            <Text fontSize="$1" color="$color8">
              +{d.sessions.length - 4} more
            </Text>
          ) : null}
        </YStack>
      ) : (
        <Text fontSize="$1" color="$color9">
          No sessions here yet.
        </Text>
      )}

      {d.registered ? (
        <XStack gap="$2" items="center">
          <Button size="$2" chromeless onPress={() => onToggle(d)}>
            {online ? 'Mark offline' : 'Mark online'}
          </Button>
          <Button size="$2" chromeless theme="red" icon={<Trash2 size={13} />} onPress={() => onRemove(d.id)} aria-label="Remove target">
            Remove
          </Button>
        </XStack>
      ) : null}
    </Card>
  )
}

function LinkComputerForm({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<TargetKind>('laptop')
  const [host, setHost] = useState('')
  const [capacity, setCapacity] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async () => {
    if (!label.trim()) {
      toast.error('A label is required')
      return
    }
    setBusy(true)
    try {
      const body: NewTarget = { label: label.trim(), kind, host: host.trim() || undefined, capacity: capacity.trim() || undefined }
      await MissionControlApi.registerTarget(body)
      toast.success('Linked', `${label.trim()} is now a run-target`)
      setLabel('')
      setHost('')
      setCapacity('')
      onDone()
      onClose()
    } catch (e) {
      toast.error('Could not link', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }, [label, kind, host, capacity, toast, onDone, onClose])

  return (
    <SlideOver open={open} onClose={onClose} title="Link a computer">
      <YStack gap="$3" p="$4">
        <Text fontSize="$2" color="$color10">
          Register a computer or GPU as a run-target a session can be dispatched to. It composes with your compute fleet.
        </Text>
        <FieldRow label="Label">
          <FieldText value={label} onChange={setLabel} placeholder="My laptop / spark GB10" />
        </FieldRow>
        <FieldRow label="Kind">
          <FieldSelect value={kind} options={['laptop', 'cloud', 'gpu', 'cluster', 'machine']} onChange={(v) => setKind(v as TargetKind)} />
        </FieldRow>
        <FieldRow label="Host">
          <FieldText value={host} onChange={setHost} placeholder="hostname (maps sessions to this machine)" />
        </FieldRow>
        <FieldRow label="Capacity">
          <FieldText value={capacity} onChange={setCapacity} placeholder="8 vCPU / 32G · 1× GB10 (optional)" />
        </FieldRow>
        <XStack gap="$2" justify="flex-end">
          <Button chromeless onPress={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button theme="light" onPress={() => void submit()} disabled={busy} icon={busy ? <Spinner size="small" /> : <Plus size={15} />}>
            Link
          </Button>
        </XStack>
      </YStack>
    </SlideOver>
  )
}

function DevicesView({ live }: { live: LiveState }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const devices = useMemo(() => deviceRoster(live.sessions, live.targets), [live.sessions, live.targets])

  const remove = useCallback(
    async (id: string) => {
      try {
        await MissionControlApi.removeTarget(id)
        toast.success('Removed')
        await live.reloadTargets()
      } catch (e) {
        toast.error('Remove failed', e instanceof Error ? e.message : undefined)
      }
    },
    [live, toast],
  )

  const toggle = useCallback(
    async (d: Device) => {
      const next = d.status === 'online' ? 'offline' : 'online'
      try {
        await MissionControlApi.patchTarget(d.id, { status: next })
        await live.reloadTargets()
      } catch (e) {
        toast.error('Update failed', e instanceof Error ? e.message : undefined)
      }
    },
    [live, toast],
  )

  return (
    <YStack gap="$3">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <Text fontSize="$3" color="$color10">
          {devices.length} {devices.length === 1 ? 'device' : 'devices'} · {live.targets.length} linked
        </Text>
        <Button size="$3" theme="light" icon={<Plus size={15} />} onPress={() => setOpen(true)}>
          Link a computer
        </Button>
      </XStack>

      {devices.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="No devices yet"
          description="Link a computer or GPU as a run-target, or run a session — the machine it runs on shows up here."
          bullets={['A run-target is a laptop, cloud box, GPU host, or cluster', 'Sessions map to a device by its host', 'Composes with your compute fleet']}
          primary={{ label: 'Link a computer', icon: <Plus size={15} />, onPress: () => setOpen(true) }}
        />
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {devices.map((d) => (
            <DeviceCard key={d.id} d={d} onRemove={(id) => void remove(id)} onToggle={(x) => void toggle(x)} />
          ))}
        </div>
      )}

      <LinkComputerForm open={open} onClose={() => setOpen(false)} onDone={() => void live.reloadTargets()} />
    </YStack>
  )
}

// ── the module ───────────────────────────────────────────────────────────────
type Tab = 'sessions' | 'devices'

export function MissionControlModule() {
  const live = useLiveSessions()
  const [tab, setTab] = useState<Tab>('sessions')
  const { sessions, eventsBySession, loadTranscript } = live

  // Load the active card's transcript on demand (the pager reports the active index).
  const onActive = useCallback(
    (i: number) => {
      const s = sessions[i]
      if (s) loadTranscript(s.id)
    },
    [sessions, loadTranscript],
  )

  const header = (
    <PageHeader
      title="Mission Control"
      subtitle="See and drive every agent session — swipe between live terminals, from anywhere."
      actions={
        <XStack gap="$2" items="center" flexWrap="wrap">
          <XStack items="center" gap="$1.5" px="$2.5" py="$1" rounded="$10" style={{ backgroundColor: live.live ? 'var(--color4)' : 'var(--color3)' }}>
            <YStack width={7} height={7} rounded="$10" bg={toneColor(live.live ? 'positive' : 'muted')} />
            <Text fontSize="$1" style={{ color: live.live ? toneVar('positive') : 'var(--color10)' }}>
              {live.live ? 'Live' : 'Polling'}
            </Text>
          </XStack>
          <XStack rounded="$5" bg="$color3" p="$1">
            <Button size="$2" chromeless={tab !== 'sessions'} theme={tab === 'sessions' ? 'light' : undefined} onPress={() => setTab('sessions')}>
              Sessions
            </Button>
            <Button size="$2" chromeless={tab !== 'devices'} theme={tab === 'devices' ? 'light' : undefined} onPress={() => setTab('devices')}>
              Devices
            </Button>
          </XStack>
          <Button size="$3" chromeless icon={<RefreshCw size={15} />} onPress={() => void live.reload()} aria-label="Refresh" />
        </XStack>
      }
    />
  )

  if (live.loading && sessions.length === 0 && !live.error) {
    return (
      <>
        {header}
        <XStack p="$6" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      </>
    )
  }

  if (live.error && sessions.length === 0) {
    return (
      <>
        {header}
        <BackendStateCard state={classifyBackend(live.error)} onRetry={() => void live.reload()} hint="endpoint · GET /v1/agents/sessions" />
      </>
    )
  }

  return (
    <>
      {header}
      {tab === 'devices' ? (
        <DevicesView live={live} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={Terminal}
          title="No agent sessions yet"
          description="Run `hanzo code` on your laptop, dispatch @hanzo in Slack, or link a GPU box — every session shows here as a live terminal you can drive."
          bullets={['Swipe between one live terminal per agent', 'Pause · resume · stop · message any session', 'See which machine each session runs on']}
          primary={{ label: 'Link a computer', icon: <Plus size={15} />, onPress: () => setTab('devices') }}
        />
      ) : (
        <SwipePager
          onActive={onActive}
          slides={sessions.map((s) => (
            <SessionCard key={s.id} s={s} events={eventsBySession[s.id] ?? seedFromLast(s)} onControl={live.control} />
          ))}
        />
      )}
    </>
  )
}

/**
 * Before a card's full transcript is fetched, seed the terminal with the compact
 * last-event the list already carries — so a card is never blank on first swipe.
 */
function seedFromLast(s: Session): SessionEvent[] {
  if (!s.lastEvent) return []
  return [
    {
      id: `${s.id}:last`,
      sessionId: s.id,
      seq: s.lastEvent.seq,
      kind: s.lastEvent.kind,
      actor: s.lastEvent.actor,
      payload: s.lastEvent.preview,
      at: s.lastEvent.at,
    },
  ]
}

