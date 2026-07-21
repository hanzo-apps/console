'use client'

/**
 * useFleetLive — the org's LIVE compute fleet, polled together while mounted:
 *  - connected workers (`/v1/fleet/workers`) — presence + heartbeat,
 *  - the gpu-jobs queue + history (`/v1/fleet/jobs`) — what's queued/running per GPU,
 *  - the board (`/v1/fleet`) — per-unit live GPU utilization + running/sessions,
 *  - the util/cost series (`/v1/fleet/samples`) — the usage sparkline.
 *
 * ONE hook so the whole connected-GPU picture refreshes on ONE cadence (the catalog /
 * clusters, which barely change, stay in `useCustomerGpuData`). Every source is
 * independent + fail-soft: a slow/denied one never blocks the others; board + samples
 * are pure enrichment and degrade to `[]`; workers + jobs carry an honest error state,
 * but a TRANSIENT poll failure never clobbers already-good data (a blink of the network
 * must not flip a live table to an error card). `cancel` cancels a job then re-polls.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  FleetApi,
  type FleetWorker,
  type FleetJob,
  type FleetBoardUnit,
  type FleetSample,
} from '~/lib/api/fleet'
import { interpretPlatformError } from '../platform/state'
import type { Async } from './state'

/** Re-poll cadence for the live fleet — brisk enough to feel live, gentle on the API. */
const POLL_MS = 6000

export type FleetLive = {
  workers: Async<FleetWorker[]>
  jobs: Async<FleetJob[]>
  units: FleetBoardUnit[]
  samples: FleetSample[]
  reload: () => void
  cancel: (job: FleetJob) => Promise<void>
}

export function useFleetLive(enabled = true): FleetLive {
  const [workers, setWorkers] = useState<Async<FleetWorker[]>>({ phase: 'loading' })
  const [jobs, setJobs] = useState<Async<FleetJob[]>>({ phase: 'loading' })
  const [units, setUnits] = useState<FleetBoardUnit[]>([])
  const [samples, setSamples] = useState<FleetSample[]>([])
  const alive = useRef(true)

  const load = useCallback((first: boolean) => {
    if (first) {
      setWorkers({ phase: 'loading' })
      setJobs({ phase: 'loading' })
    }
    FleetApi.workers()
      .then((d) => alive.current && setWorkers({ phase: 'ready', data: d }))
      // Keep good data through a transient poll error; only surface an error if we
      // never had any (a real load failure, not a blink).
      .catch((e) => alive.current && setWorkers((p) => (p.phase === 'ready' ? p : { phase: 'error', error: interpretPlatformError(e) })))
    FleetApi.jobs()
      .then((d) => alive.current && setJobs({ phase: 'ready', data: d }))
      .catch((e) => alive.current && setJobs((p) => (p.phase === 'ready' ? p : { phase: 'error', error: interpretPlatformError(e) })))
    FleetApi.board()
      .then((d) => alive.current && setUnits(d))
      .catch(() => undefined) // pure enrichment — a wedged board costs util, not the page
    FleetApi.samples()
      .then((d) => alive.current && setSamples(d))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!enabled) return
    alive.current = true
    load(true)
    const t = setInterval(() => load(false), POLL_MS)
    return () => {
      alive.current = false
      clearInterval(t)
    }
  }, [load, enabled])

  const reload = useCallback(() => load(true), [load])
  const cancel = useCallback(
    async (job: FleetJob) => {
      await FleetApi.cancel(job.id, job.runId)
      load(false)
    },
    [load],
  )

  return { workers, jobs, units, samples, reload, cancel }
}
