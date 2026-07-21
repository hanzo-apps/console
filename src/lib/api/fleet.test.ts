import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FleetApi,
  acceleratorLabel,
  engineServing,
  fleetMemGb,
  fmtHeartbeat,
  normalizeWorker,
  onlineCount,
  workerOnline,
  normalizeJob,
  normalizeJobStatus,
  normalizeUnit,
  normalizeSample,
  utilToPct,
  jobsForWorker,
  queuedJobs,
  runningJob,
  queueDepth,
  runningCount,
  queueSummary,
  jobTone,
  utilForWorker,
  avgGpuUtil,
  utilSeries,
  totalCostUsd,
  fmtDuration,
  fmtJobStatus,
  isTerminal,
  jobActive,
  type FleetWorker,
  type FleetJob,
  type FleetBoardUnit,
} from './fleet'
import { cloudProxyV1Url } from './client'

const job = (over: Partial<FleetJob>): FleetJob => ({ id: 'j', status: 'queued', ...over })
const unit = (over: Partial<FleetBoardUnit>): FleetBoardUnit => ({ source: 'byo', unit: 'u', running: 0, sessions: 0, ...over })

/** A byoWorker as `GET /v1/fleet/workers` reports a `hanzo gpu connect` box. */
const raw = {
  id: 'spark',
  hostname: 'spark',
  provider: 'byo',
  location: 'on-prem',
  status: 'online',
  gpus: [{ name: 'NVIDIA GB10', memoryTotal: '131072 MiB' }],
  lastHeartbeat: '2026-07-16T12:00:00Z',
  firstSeen: '2026-07-01T00:00:00Z',
  os: 'linux',
  version: '1.2.3',
  capabilities: ['studio.render', 'engine.serve'],
  engine: { url: 'http://spark:8080', apis: ['openai', 'anthropic'], models: ['zen5'], status: 'ready' },
}

describe('normalizeWorker', () => {
  it('maps the byoWorker shape and parses GPU memory (MiB → GB)', () => {
    const w = normalizeWorker(raw)
    expect(w.id).toBe('spark')
    expect(w.hostname).toBe('spark')
    expect(w.provider).toBe('byo')
    expect(w.status).toBe('online')
    expect(w.gpus).toHaveLength(1)
    expect(w.gpus[0]).toEqual({ name: 'NVIDIA GB10', memoryGb: 128 })
    expect(w.lastHeartbeat).toBe('2026-07-16T12:00:00Z')
    expect(w.os).toBe('linux')
    expect(w.capabilities).toEqual(['studio.render', 'engine.serve'])
    expect(w.engine).toEqual({ url: 'http://spark:8080', apis: ['openai', 'anthropic'], models: ['zen5'], status: 'ready' })
  })

  it('synthesizes an id and defaults provider, never throwing on garbage', () => {
    expect(normalizeWorker({}, 3).id).toBe('worker-3')
    expect(normalizeWorker('garbage').id).toBe('worker-0')
    expect(normalizeWorker({ hostname: 'dbc' }).provider).toBe('byo')
    expect(normalizeWorker({ hostname: 'dbc' }).gpus).toEqual([])
    expect(normalizeWorker({ hostname: 'dbc' }).engine).toBeUndefined()
  })

  it('reads a Mac reporting unified memory as the accelerator memory', () => {
    const w = normalizeWorker({ id: 'dbc', hostname: 'dbc', status: 'online', os: 'darwin', gpus: [{ name: 'Apple M3 Max', memoryTotal: '131072 MiB' }] })
    expect(w.gpus[0]).toEqual({ name: 'Apple M3 Max', memoryGb: 128 })
    expect(fleetMemGb(w)).toBe(128)
  })
})

describe('pure view helpers', () => {
  it('acceleratorLabel groups identical accelerators and joins distinct ones', () => {
    expect(acceleratorLabel(normalizeWorker(raw))).toBe('NVIDIA GB10')
    expect(acceleratorLabel(normalizeWorker({ gpus: [{ name: 'NVIDIA GB10' }, { name: 'NVIDIA GB10' }] }))).toBe('2× NVIDIA GB10')
    expect(acceleratorLabel(normalizeWorker({ gpus: [{ name: 'H100' }, { name: 'A100' }] }))).toBe('H100, A100')
    expect(acceleratorLabel(normalizeWorker({ gpus: [] }))).toBe('—')
  })

  it('fleetMemGb sums reported memory, undefined when none is reported', () => {
    expect(fleetMemGb(normalizeWorker({ gpus: [{ name: 'a', memoryTotal: '81920 MiB' }, { name: 'b', memoryTotal: '81920 MiB' }] }))).toBe(160)
    expect(fleetMemGb(normalizeWorker({ gpus: [{ name: 'a' }] }))).toBeUndefined()
  })

  it('workerOnline / engineServing / onlineCount read the real state', () => {
    const online = normalizeWorker(raw)
    const offline = normalizeWorker({ id: 'x', status: 'offline', capabilities: [] })
    expect(workerOnline(online)).toBe(true)
    expect(workerOnline(offline)).toBe(false)
    expect(engineServing(online)).toBe(true) // engine.status === 'ready'
    expect(engineServing(normalizeWorker({ id: 'y', capabilities: ['engine.serve'] }))).toBe(true) // capability
    expect(engineServing(offline)).toBe(false)
    expect(onlineCount([online, offline])).toBe(1)
  })

  it('fmtHeartbeat renders compact relative time and honest — for absent', () => {
    const now = Date.parse('2026-07-16T12:00:00Z')
    expect(fmtHeartbeat(undefined, now)).toBe('—')
    expect(fmtHeartbeat('nonsense', now)).toBe('—')
    expect(fmtHeartbeat('2026-07-16T11:59:58Z', now)).toBe('just now')
    expect(fmtHeartbeat('2026-07-16T11:59:30Z', now)).toBe('30s ago')
    expect(fmtHeartbeat('2026-07-16T11:57:00Z', now)).toBe('3m ago')
    expect(fmtHeartbeat('2026-07-16T09:00:00Z', now)).toBe('3h ago')
    expect(fmtHeartbeat('2026-07-14T12:00:00Z', now)).toBe('2d ago')
  })
})

describe('FleetApi.workers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the /v1 user-bearer proxy at fleet/workers and unwraps { workers }', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(String(url))
      return { status: 200, ok: true, text: async () => JSON.stringify({ workers: [raw] }), json: async () => ({ workers: [raw] }) } as unknown as Response
    }))
    const workers: FleetWorker[] = await FleetApi.workers()
    expect(seen[0]).toBe(cloudProxyV1Url('fleet/workers'))
    expect(seen[0]).toContain('/v1/fleet/workers')
    expect(workers).toHaveLength(1)
    expect(workers[0].hostname).toBe('spark')
  })
})

// ── Per-GPU queue (gpu-jobs) ──────────────────────────────────────────────────

describe('normalizeWorker — no longer drops jobQueue', () => {
  it('parses jobQueue (camel + snake), honest-undefined when absent', () => {
    expect(normalizeWorker({ hostname: 'spark', jobQueue: 'gpu-jobs' }).jobQueue).toBe('gpu-jobs')
    expect(normalizeWorker({ hostname: 'spark', job_queue: 'gpu-jobs' }).jobQueue).toBe('gpu-jobs')
    expect(normalizeWorker({ hostname: 'spark' }).jobQueue).toBeUndefined()
  })
})

describe('normalizeJobStatus — canonical + raw engine states', () => {
  it('passes canonical statuses through', () => {
    for (const s of ['queued', 'running', 'completed', 'failed', 'canceled']) expect(normalizeJobStatus(s)).toBe(s)
  })
  it('maps raw ACTIVITY_TASK_STATE_* and scheduled/started/pending', () => {
    expect(normalizeJobStatus('ACTIVITY_TASK_STATE_SCHEDULED')).toBe('queued')
    expect(normalizeJobStatus('ACTIVITY_TASK_STATE_STARTED')).toBe('running')
    expect(normalizeJobStatus('ACTIVITY_TASK_STATE_COMPLETED')).toBe('completed')
    expect(normalizeJobStatus('scheduled')).toBe('queued')
    expect(normalizeJobStatus('started')).toBe('running')
    expect(normalizeJobStatus('pending')).toBe('queued')
  })
  it('degrades unknown/empty to queued (never throws)', () => {
    expect(normalizeJobStatus(undefined)).toBe('queued')
    expect(normalizeJobStatus('weird')).toBe('queued')
  })
})

describe('normalizeJob — defensive shape', () => {
  it('reads id/workflowId, gpu/target, worker/identity, status coercion', () => {
    const j = normalizeJob({ workflowId: 'wf1', runId: 'r1', type: 'studio.render', status: 'STARTED', target: 'spark', identity: 'spark', attempt: 2, startTime: 't0', failure_cause: 'boom' })
    expect(j).toMatchObject({ id: 'wf1', runId: 'r1', type: 'studio.render', status: 'running', gpu: 'spark', worker: 'spark', attempt: 2, failureCause: 'boom' })
  })
  it('falls back to a stable id and empty gpu (shared pool)', () => {
    expect(normalizeJob({}, 3).id).toBe('job-3')
    expect(normalizeJob({}).gpu).toBe('')
  })
})

describe('jobsForWorker / runningJob / queue* — join by claimed OR targeted', () => {
  const jobs = [
    job({ id: 'a', status: 'running', worker: 'spark' }),
    job({ id: 'b', status: 'queued', gpu: 'spark' }),
    job({ id: 'c', status: 'queued', gpu: '' }),
    job({ id: 'd', status: 'queued', gpu: 'dbc' }),
    job({ id: 'e', status: 'completed', worker: 'spark' }),
  ]
  it('jobsForWorker returns claimed + targeted, excludes other GPUs and shared', () => {
    expect(jobsForWorker(jobs, 'spark').map((j) => j.id).sort()).toEqual(['a', 'b', 'e'])
    expect(jobsForWorker(jobs, 'dbc').map((j) => j.id)).toEqual(['d'])
  })
  it('runningJob is the in-flight claimed/targeting job, else undefined', () => {
    expect(runningJob(jobs, 'spark')?.id).toBe('a')
    expect(runningJob(jobs, 'dbc')).toBeUndefined()
  })
  it('queuedJobs(all) counts every queued; per-worker only its targeted', () => {
    expect(queuedJobs(jobs).map((j) => j.id).sort()).toEqual(['b', 'c', 'd'])
    expect(queuedJobs(jobs, 'spark').map((j) => j.id)).toEqual(['b'])
  })
  it('queueDepth / runningCount total and per-worker', () => {
    expect(queueDepth(jobs)).toBe(3)
    expect(queueDepth(jobs, 'spark')).toBe(1)
    expect(runningCount(jobs)).toBe(1)
    expect(runningCount(jobs, 'dbc')).toBe(0)
  })
  it('queueSummary is idle when nothing, else running · queued', () => {
    expect(queueSummary(jobs, 'spark')).toBe('1 running · 1 queued')
    expect(queueSummary(jobs, 'evo')).toBe('idle')
  })
})

describe('jobTone / isTerminal / jobActive', () => {
  it('maps each status to its pill tone', () => {
    expect(jobTone('running')).toBe('run')
    expect(jobTone('completed')).toBe('ok')
    expect(jobTone('failed')).toBe('down')
    expect(jobTone('queued')).toBe('idle')
    expect(jobTone('canceled')).toBe('idle')
  })
  it('classifies lifecycle', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('running')).toBe(false)
    expect(jobActive(job({ status: 'queued' }))).toBe(true)
    expect(jobActive(job({ status: 'failed' }))).toBe(false)
  })
})

describe('utilToPct — tolerate 0..1 fraction OR 0..100 percent', () => {
  it('scales a fraction and clamps a percent', () => {
    expect(utilToPct(0.5)).toBe(50)
    expect(utilToPct(1)).toBe(100)
    expect(utilToPct(73)).toBe(73)
    expect(utilToPct(150)).toBe(100)
    expect(utilToPct('0.25')).toBe(25)
    expect(utilToPct(undefined)).toBeUndefined()
  })
})

describe('board util helpers', () => {
  const units = [
    unit({ unit: 'spark', source: 'byo', gpuUtil: 80 }),
    unit({ unit: 'spark', source: 'agent', gpuUtil: 10 }),
    unit({ unit: 'dbc', source: 'byo' }),
    unit({ unit: 'cloud', source: 'visor', gpuUtil: 40 }),
  ]
  it('utilForWorker prefers the BYO row, honest-undefined when none', () => {
    expect(utilForWorker(units, 'spark')).toBe(80)
    expect(utilForWorker(units, 'dbc')).toBeUndefined()
    expect(utilForWorker(units, 'nope')).toBeUndefined()
  })
  it('avgGpuUtil averages only reporting units', () => {
    expect(avgGpuUtil(units)).toBe(Math.round((80 + 10 + 40) / 3))
    expect(avgGpuUtil([unit({ unit: 'x' })])).toBeUndefined()
  })
  it('normalizeUnit reads metrics.gpuUtil to pct and defaults counts to 0', () => {
    const u = normalizeUnit({ source: 'byo', unit: 'spark', metrics: { gpuUtil: 0.9 }, spec: { gpus: 1, gpuModel: 'NVIDIA GB10' } })
    expect(u).toMatchObject({ gpuUtil: 90, running: 0, sessions: 0, gpus: 1, gpuModel: 'NVIDIA GB10' })
  })
})

describe('samples — util series + cost', () => {
  it('utilSeries sorts by time and drops untelemetried points', () => {
    const samples = [
      normalizeSample({ at: '2026-07-21T02:00:00Z', gpuUtil: 0.5 }),
      normalizeSample({ at: '2026-07-21T01:00:00Z', gpuUtil: 0.2 }),
      normalizeSample({ at: '2026-07-21T03:00:00Z' }),
    ]
    expect(utilSeries(samples)).toEqual([20, 50])
  })
  it('totalCostUsd sums cents to dollars, honest-undefined when none', () => {
    expect(totalCostUsd([normalizeSample({ costCents: 150 }), normalizeSample({ cost_cents: 350 })])).toBe(5)
    expect(totalCostUsd([normalizeSample({ gpuUtil: 0.5 })])).toBeUndefined()
  })
})

describe('formatters', () => {
  it('fmtDuration is compact and closed-vs-running aware', () => {
    const start = '2026-07-21T00:00:00Z'
    expect(fmtDuration(undefined)).toBe('—')
    expect(fmtDuration(start, '2026-07-21T00:00:45Z')).toBe('45s')
    expect(fmtDuration(start, '2026-07-21T00:03:20Z')).toBe('3m 20s')
    expect(fmtDuration(start, '2026-07-21T02:05:00Z')).toBe('2h 5m')
    expect(fmtDuration(start, undefined, Date.parse('2026-07-21T00:00:10Z'))).toBe('10s')
  })
  it('fmtJobStatus title-cases', () => {
    expect(fmtJobStatus('running')).toBe('Running')
    expect(fmtJobStatus('')).toBe('—')
  })
})

describe('FleetApi.jobs / board / samples / cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stub = (payload: unknown) => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(String(url) + (init?.method && init.method !== 'GET' ? ` [${init.method}]` : ''))
      return { status: 200, ok: true, text: async () => JSON.stringify(payload), json: async () => payload } as unknown as Response
    }))
    return seen
  }

  it('jobs() reads /v1/fleet/jobs, forwards gpu/status filters, unwraps { jobs }', async () => {
    const seen = stub({ jobs: [{ workflowId: 'wf1', type: 'studio.render', status: 'running', worker: 'spark' }] })
    const jobs = await FleetApi.jobs({ gpu: 'spark', status: 'running' })
    expect(seen[0]).toContain('/v1/fleet/jobs?')
    expect(seen[0]).toContain('gpu=spark')
    expect(seen[0]).toContain('status=running')
    expect(jobs[0]).toMatchObject({ id: 'wf1', status: 'running', worker: 'spark' })
  })

  it('board() reads /v1/fleet and unwraps { units }', async () => {
    const seen = stub({ units: [{ source: 'byo', unit: 'spark', metrics: { gpuUtil: 0.5 } }] })
    const units = await FleetApi.board()
    expect(seen[0]).toContain('/v1/fleet')
    expect(units[0]).toMatchObject({ unit: 'spark', gpuUtil: 50 })
  })

  it('samples() reads /v1/fleet/samples with a range and unwraps { samples }', async () => {
    const seen = stub({ samples: [{ at: 't', gpuUtil: 0.5, costCents: 100 }] })
    const s = await FleetApi.samples('range=24h')
    expect(seen[0]).toContain('/v1/fleet/samples?range=24h')
    expect(s[0]).toMatchObject({ gpuUtil: 50, costCents: 100 })
  })

  it('cancel() POSTs /v1/fleet/jobs/:id/cancel with { run, reason }', async () => {
    const seen = stub({ ok: true })
    await FleetApi.cancel('wf1', 'r1', 'user cancel')
    expect(seen[0]).toContain('/v1/fleet/jobs/wf1/cancel')
    expect(seen[0]).toContain('[POST]')
  })
})
