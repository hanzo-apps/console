'use client'

/**
 * useLiveSessions — the ONE live data layer behind Mission Control. It reads the
 * agent-session plane (`/v1/agents/sessions` + `/v1/agents/targets`) and tails the
 * plane's existing SSE stream (`/v1/agents/sessions/stream`) so cards update in place,
 * with a slow poll as an always-on backstop (so counts stay fresh even if the stream
 * drops or a proxy buffers it). Org isolation is SERVER-side (the plane resolves the
 * org from the bearer owner) — this hook never sends an org.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  MissionControlApi,
  mergeEvents,
  normalizeEvent,
  normalizeSession,
  type ControlCommand,
  type Session,
  type SessionEvent,
  type SessionStatus,
  type Target,
} from '~/lib/api/mission-control'

const POLL_MS = 12000

export type LiveState = {
  sessions: Session[]
  targets: Target[]
  eventsBySession: Record<string, SessionEvent[]>
  loading: boolean
  error: unknown
  live: boolean
  reload: () => Promise<void>
  reloadTargets: () => Promise<void>
  loadTranscript: (id: string) => void
  control: (id: string, cmd: ControlCommand, message?: string) => Promise<void>
}

function upsertSession(prev: Session[], s: Session): Session[] {
  const i = prev.findIndex((x) => x.id === s.id)
  if (i < 0) return [s, ...prev]
  const next = prev.slice()
  next[i] = { ...next[i], ...s }
  return next
}

const optimisticStatus = (cmd: ControlCommand, cur: SessionStatus): SessionStatus =>
  cmd === 'pause' ? 'paused' : cmd === 'resume' ? 'running' : cmd === 'stop' ? 'done' : cur

export function useLiveSessions(): LiveState {
  const [sessions, setSessions] = useState<Session[]>([])
  const [targets, setTargets] = useState<Target[]>([])
  const [eventsBySession, setEvents] = useState<Record<string, SessionEvent[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [live, setLive] = useState(false)
  const loadedRef = useRef<Set<string>>(new Set())

  const reload = useCallback(async () => {
    try {
      const ss = await MissionControlApi.sessions()
      setSessions((prev) => reconcile(prev, ss))
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  const reloadTargets = useCallback(async () => {
    try {
      setTargets(await MissionControlApi.targets())
    } catch {
      /* targets are best-effort; a failure never blanks the sessions board */
    }
  }, [])

  const loadTranscript = useCallback(async (id: string) => {
    if (loadedRef.current.has(id)) return
    loadedRef.current.add(id)
    try {
      const d = await MissionControlApi.session(id)
      if (d) setEvents((m) => ({ ...m, [id]: mergeEvents(m[id] ?? [], d.recentEvents) }))
    } catch {
      loadedRef.current.delete(id)
    }
  }, [])

  const control = useCallback(
    async (id: string, cmd: ControlCommand, message?: string) => {
      await MissionControlApi.control(id, cmd, message)
      if (cmd !== 'message') {
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status: optimisticStatus(cmd, s.status) } : s)))
      }
      await reload()
    },
    [reload],
  )

  // Initial load + SSE tail + poll backstop.
  useEffect(() => {
    void reload()
    void reloadTargets()

    let poll: ReturnType<typeof setInterval> | null = null
    const startPoll = () => {
      if (!poll)
        poll = setInterval(() => {
          void reload()
          void reloadTargets()
        }, POLL_MS)
    }

    let es: EventSource | null = null
    try {
      es = new EventSource(MissionControlApi.streamUrl(), { withCredentials: true })
      es.addEventListener('session', (ev) => {
        try {
          const s = normalizeSession(JSON.parse((ev as MessageEvent).data).session)
          if (s) setSessions((prev) => upsertSession(prev, s))
        } catch {
          /* skip a malformed frame */
        }
      })
      es.addEventListener('event', (ev) => {
        try {
          const e = normalizeEvent(JSON.parse((ev as MessageEvent).data).event)
          if (!e) return
          if (loadedRef.current.has(e.sessionId)) {
            setEvents((m) => ({ ...m, [e.sessionId]: mergeEvents(m[e.sessionId] ?? [], [e]) }))
          }
          setSessions((prev) =>
            prev.map((s) =>
              s.id === e.sessionId
                ? { ...s, updatedAt: e.at, events: s.events + 1, lastEvent: { seq: e.seq, kind: e.kind, actor: e.actor, at: e.at } }
                : s,
            ),
          )
        } catch {
          /* skip a malformed frame */
        }
      })
      es.onopen = () => setLive(true)
      es.onerror = () => {
        setLive(false) // EventSource auto-reconnects; the poll backstop keeps data fresh meanwhile
      }
    } catch {
      /* environments without EventSource fall back to the poll below */
    }
    startPoll()

    return () => {
      es?.close()
      if (poll) clearInterval(poll)
    }
  }, [reload, reloadTargets])

  return { sessions, targets, eventsBySession, loading, error, live, reload, reloadTargets, loadTranscript, control }
}

/**
 * Merge a freshly-fetched list into the current one, preserving the SSE-carried live
 * fields (lastEvent/updatedAt) when the poll's row is staler — so a background refetch
 * never blanks a card the stream just updated. New rows are added; gone rows dropped.
 */
function reconcile(prev: Session[], next: Session[]): Session[] {
  const prevById = new Map(prev.map((s) => [s.id, s]))
  return next.map((n) => {
    const p = prevById.get(n.id)
    if (!p) return n
    // Keep the higher event count + the most recent lastEvent (stream may lead the poll).
    const events = Math.max(n.events, p.events)
    const lastEvent = (p.lastEvent?.seq ?? 0) > (n.lastEvent?.seq ?? 0) ? p.lastEvent : n.lastEvent
    return { ...n, events, lastEvent }
  })
}
