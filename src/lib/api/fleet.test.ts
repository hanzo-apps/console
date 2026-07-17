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
  type FleetWorker,
} from './fleet'
import { cloudProxyV1Url } from './client'

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
