'use client'

/**
 * useFleetLive — the org's LIVE compute fleet, polled together while mounted:
 *  - connected workers (`/v1/visor/fleet/workers`) — presence + heartbeat,
 *  - the gpu-jobs queue + recent history (`/v1/visor/fleet/jobs`, recency-BOUNDED) — what's
 *    queued/running per GPU,
 *  - the board (`/v1/visor/fleet`) — per-unit live GPU utilization + running/sessions,
 *  - the util/cost series (`/v1/visor/fleet/samples`) — the usage sparkline.
 *
 * ONE hook so the whole connected-GPU picture refreshes on ONE cadence (the catalog /
 * clusters, which barely change, stay in `useCustomerGpuData`). Callers pass `enabled`
 * so it only polls on the tabs that show it. Correctness guards:
 *  - IN-FLIGHT + GENERATION guard: overlapping/slow polls never stack, and an older
 *    response that lands after a newer one is DROPPED (no out-of-order clobber).
 *  - FAIL-SOFT + STALE: board/samples are enrichment (degrade to `[]`); a transient poll
 *    error never clobbers already-good workers/jobs data but flips `stale` so the UI can
 *    say "last updated Ns ago" instead of showing old data as live forever.
 *  - CANCEL: `cancel` optimistically marks a job pending, then RECONCILES on the next poll
 *    (drops the pending key once the job leaves the active set). It REJECTS on 4xx/5xx so
 *    the caller surfaces the error — never swallowed.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  FleetApi,
  jobKey,
  reconcilePending,
  type FleetWorker,
  type FleetJob,
  type FleetBoardUnit,
  type FleetSample,
} from '~/lib/api/fleet'
import { interpretPlatformError } from '../platform/state'
import type { Async } from './state'

/** Re-poll cadence for the live fleet — brisk enough to feel live, gentle on the API. */
const POLL_MS = 6000
/** Bound the jobs poll to the backend's recency read so a long-lived org never streams an
 *  unbounded history every few seconds. The backend owns the real bound; this is the hint. */
const JOBS_LIMIT = 200

export type FleetLive = {
  workers: Async<FleetWorker[]>
  jobs: Async<FleetJob[]>
  units: FleetBoardUnit[]
  samples: FleetSample[]
  /** ms epoch of the last SUCCESSFUL jobs poll, or null (never yet loaded). */
  updatedAt: number | null
  /** True when the most recent poll FAILED while prior data is still shown (data is stale). */
  stale: boolean
  reload: () => void
  /** Request a cancel: optimistic pending + reconcile on the next poll; REJECTS on 4xx/5xx
   *  so the caller can surface it (never swallowed). */
  cancel: (job: FleetJob) => Promise<void>
  /** True while a job's cancel is in flight / awaiting the poll to reflect it. */
  isCanceling: (job: FleetJob) => boolean
}

export function useFleetLive(enabled = true): FleetLive {
  const [workers, setWorkers] = useState<Async<FleetWorker[]>>({ phase: 'loading' })
  const [jobs, setJobs] = useState<Async<FleetJob[]>>({ phase: 'loading' })
  const [units, setUnits] = useState<FleetBoardUnit[]>([])
  const [samples, setSamples] = useState<FleetSample[]>([])
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [stale, setStale] = useState(false)
  const [pending, setPending] = useState<Set<string>>(() => new Set())

  const alive = useRef(true)
  const gen = useRef(0) // request generation — only the LATEST load's responses apply
  const inFlight = useRef(false)

  const load = useCallback((first: boolean) => {
    if (inFlight.current && !first) return // don't stack overlapping interval polls
    const myGen = ++gen.current
    inFlight.current = true
    const fresh = () => alive.current && myGen === gen.current // drop stale/out-of-order responses
    if (first) {
      setWorkers({ phase: 'loading' })
      setJobs({ phase: 'loading' })
    }

    const pWorkers = FleetApi.workers()
      .then((d) => {
        if (fresh()) setWorkers({ phase: 'ready', data: d })
      })
      .catch((e) => {
        if (fresh()) {
          setStale(true)
          setWorkers((p) => (p.phase === 'ready' ? p : { phase: 'error', error: interpretPlatformError(e) }))
        }
      })

    const pJobs = FleetApi.jobs({ limit: JOBS_LIMIT })
      .then((d) => {
        if (!fresh()) return
        setJobs({ phase: 'ready', data: d })
        setUpdatedAt(Date.now())
        setStale(false)
        setPending((prev) => (prev.size ? new Set(reconcilePending([...prev], d)) : prev))
      })
      .catch((e) => {
        if (fresh()) {
          setStale(true)
          setJobs((p) => (p.phase === 'ready' ? p : { phase: 'error', error: interpretPlatformError(e) }))
        }
      })

    // Board + samples are pure enrichment — a wedged one costs util, not the page.
    FleetApi.board().then((d) => { if (fresh()) setUnits(d) }).catch(() => undefined)
    FleetApi.samples().then((d) => { if (fresh()) setSamples(d) }).catch(() => undefined)

    void Promise.allSettled([pWorkers, pJobs]).then(() => {
      if (myGen === gen.current) inFlight.current = false
    })
  }, [])

  useEffect(() => {
    if (!enabled) return
    alive.current = true
    load(true)
    const t = setInterval(() => load(false), POLL_MS)
    return () => {
      alive.current = false
      inFlight.current = false
      clearInterval(t)
    }
  }, [load, enabled])

  const reload = useCallback(() => load(true), [load])

  const cancel = useCallback(
    async (job: FleetJob) => {
      const k = jobKey(job)
      setPending((p) => new Set(p).add(k)) // optimistic: reflect "canceling" immediately
      try {
        await FleetApi.cancel(job.id, job.runId)
        load(false) // reconcile — the poll drops the pending key once the job leaves active
      } catch (e) {
        setPending((p) => {
          const n = new Set(p)
          n.delete(k)
          return n
        }) // revert the optimistic mark
        throw e // surface to the caller (toast) — never swallowed
      }
    },
    [load],
  )

  const isCanceling = useCallback((job: FleetJob) => pending.has(jobKey(job)), [pending])

  return { workers, jobs, units, samples, updatedAt, stale, reload, cancel, isCanceling }
}
