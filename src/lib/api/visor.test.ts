import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, cloudProxyV1Url, vmProxyV1Url } from './client'
import {
  filterSizes,
  fmtSpec,
  interpretVisorError,
  normalizeGpuSize,
  normalizeMachine,
  normalizeRegion,
  normalizeSize,
  prettyGpuModel,
  statusVerdict,
  VisorApi,
  type VisorSize,
} from './visor'

describe('normalizeMachine', () => {
  it('maps common field aliases and fills an id', () => {
    const m = normalizeMachine({ uuid: 'abc', hostname: 'web-1', zone: 'sfo3', size: 's-2vcpu-4gb', state: 'running', vcpus: 2, memoryGb: 4, publicIp: '1.2.3.4' })
    expect(m.id).toBe('abc')
    expect(m.name).toBe('web-1')
    expect(m.region).toBe('sfo3')
    expect(m.type).toBe('s-2vcpu-4gb')
    expect(m.status).toBe('running')
    expect(m.vcpu).toBe(2)
    expect(m.memGb).toBe(4)
    expect(m.ip).toBe('1.2.3.4')
  })

  it('synthesizes an id when none is present (never throws)', () => {
    expect(normalizeMachine({}, 3).id).toBe('machine-3')
    expect(normalizeMachine('garbage').id).toBe('machine-0')
  })

  it('reads a nested gpu object model', () => {
    expect(normalizeMachine({ id: 'g', gpu: { model: 'H100', count: 8 } }).gpu).toBe('H100')
  })

  it('passes provider through so cloud vs BYO can be badged', () => {
    expect(normalizeMachine({ id: 'a', provider: 'doks' }).provider).toBe('doks')
    // A bring-your-own on-prem worker in the unioned inventory.
    expect(normalizeMachine({ id: 'b', provider: 'byo', region: 'on-prem' }).provider).toBe('byo')
    // Absent on older responses → undefined (never a fabricated value).
    expect(normalizeMachine({ id: 'c' }).provider).toBeUndefined()
  })
})

describe('interpretVisorError — an error is an error, never the empty state', () => {
  it('only a genuine 401 (no session) is a sign-in prompt', () => {
    expect(interpretVisorError(new ApiError('no', 401)).kind).toBe('unauthorized')
  })

  it('403 → an honest permission state (NOT sign-in, NOT the empty "launch" state)', () => {
    const v = interpretVisorError(new ApiError('no', 403))
    expect(v.kind).toBe('forbidden')
    // Must NOT tell a signed-in user to sign in (that reads as broken).
    expect(v.message.toLowerCase()).not.toContain('sign in')
  })

  it('404 / 5xx / network → an honest transient error (retryable), never "you have none"', () => {
    for (const e of [new ApiError('x', 404), new ApiError('x', 500), new ApiError('x', 501), new ApiError('x', 503), new Error('network')]) {
      expect(interpretVisorError(e).kind).toBe('error')
    }
  })

  it('no state leaks infra-token / not-configured jargon to a customer', () => {
    for (const e of [new ApiError('x', 401), new ApiError('x', 403), new ApiError('x', 404), new ApiError('x', 503), new Error('network')]) {
      const v = interpretVisorError(e)
      expect(v.message.toLowerCase()).not.toContain('token')
      expect(v.message.toLowerCase()).not.toContain('not configured')
    }
  })
})

describe('fmtSpec / statusVerdict', () => {
  it('formats a spec honestly', () => {
    expect(fmtSpec({ id: 'a', vcpu: 4, memGb: 8 })).toBe('4 vCPU · 8 GB')
    expect(fmtSpec({ id: 'a', vcpu: 4 })).toBe('4 vCPU')
    expect(fmtSpec({ id: 'a' })).toBe('—')
  })
  it('classifies status', () => {
    expect(statusVerdict('running')).toBe('ok')
    expect(statusVerdict('provisioning')).toBe('warn')
    expect(statusVerdict('terminated')).toBe('down')
    expect(statusVerdict('weird')).toBe('idle')
  })
})

describe('compute catalog normalizers (real visor shapes)', () => {
  it('prettyGpuModel renders vendor slugs as display names', () => {
    expect(prettyGpuModel('nvidia_l40s')).toBe('L40S')
    expect(prettyGpuModel('nvidia_h100')).toBe('H100')
    expect(prettyGpuModel('nvidia_rtx4000_ada')).toBe('RTX 4000 Ada')
    expect(prettyGpuModel(undefined)).toBeUndefined()
  })

  it('normalizeRegion counts sizes and reads availability', () => {
    const r = normalizeRegion({ slug: 'nyc1', name: 'New York 1', available: true, sizes: ['a', 'b', 'c'] })
    expect(r).toMatchObject({ slug: 'nyc1', name: 'New York 1', available: true, sizeCount: 3 })
    expect(normalizeRegion({ slug: 'x' })).toMatchObject({ available: false, sizeCount: 0 })
  })

  it('normalizeSize converts memoryMb→GB and reads price', () => {
    const s = normalizeSize({ slug: 's-2vcpu-2gb', vcpus: 2, memoryMb: 2048, diskGb: 60, available: true, priceHourly: 0.03, priceMonthly: 18 })
    expect(s).toMatchObject({ slug: 's-2vcpu-2gb', vcpus: 2, memGb: 2, diskGb: 60, available: true, priceHourly: 0.03, priceMonthly: 18 })
  })

  it('normalizeSize reads the region list (defaults to [], drops non-strings)', () => {
    expect(normalizeSize({ slug: 'x', regions: ['nyc1', 'sfo3'] }).regions).toEqual(['nyc1', 'sfo3'])
    expect(normalizeSize({ slug: 'y' }).regions).toEqual([])
    expect(normalizeSize({ slug: 'z', regions: ['a', 5, null, 'b'] }).regions).toEqual(['a', 'b'])
  })

  it('normalizeGpuSize reads the nested gpu object + VRAM unit', () => {
    const g = normalizeGpuSize({
      slug: 'gpu-l40sx1-48gb', vcpus: 8, memoryMb: 65536, diskGb: 500, available: true, priceHourly: 1.57,
      gpu: { count: 1, model: 'nvidia_l40s', vram: 48, vramUnit: 'gib' },
    })
    expect(g).toMatchObject({ slug: 'gpu-l40sx1-48gb', vcpus: 8, memGb: 64, model: 'L40S', gpuCount: 1, vramGb: 48, priceHourly: 1.57 })
  })
})

describe('VisorApi routes each call to the correct server proxy (Problem-1 regression)', () => {
  // ROOT CAUSE of "Accelerators 0 available to launch": the accelerator CATALOG lives on
  // VISOR (a distinct backend), NOT cloud-api — cloud-api serves no visor catalog route,
  // and its `/v1/visor/gpus` is a different (per-org inventory) shape. So the catalog MUST
  // address the `/v1/vm` (visor) proxy, while machines ride the cloud `/v1` bearer BFF. This
  // test mocks fetch and pins the exact URL each call hits — the guard that would have
  // caught the wrong-backend bug (mirrors the v8.4.34 wiring lesson).
  const seen: { url: string; method: string; body?: string }[] = []
  const stubFetch = (body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      seen.push({ url: String(url), method, body: init?.body as string | undefined })
      if (method === 'DELETE') return { status: 204, ok: true, text: async () => '', json: async () => ({}) } as unknown as Response
      return { status: 200, ok: true, text: async () => JSON.stringify(body), json: async () => body } as unknown as Response
    }))
  afterEach(() => { seen.length = 0; vi.unstubAllGlobals() })

  it('catalog (gpus / regions / sizes) reads the VISOR /vm proxy — never a bare /v1', async () => {
    stubFetch({ data: [] })
    await VisorApi.gpus()
    await VisorApi.regions()
    await VisorApi.sizes()
    expect(seen.map((s) => s.url)).toEqual([vmProxyV1Url('gpus'), vmProxyV1Url('regions'), vmProxyV1Url('sizes')])
    for (const s of seen) expect(s.url).toContain('/v1/vm/')
  })

  it('machines list uses the /v1 user-bearer proxy (org from the Bearer owner)', async () => {
    stubFetch({ machines: [] })
    await VisorApi.machines()
    expect(seen[0].url).toBe(cloudProxyV1Url('visor/machines'))
    expect(seen[0].url).toContain('/v1/visor/machines')
  })

  it('launch POSTs a real (dryRun:false) launch to /v1/visor/machines', async () => {
    stubFetch({ status: 'ok', data: { id: 'm1' } })
    await VisorApi.launch({ size: 'gpu-h100x1-80gb', region: 'nyc1', name: 'box' })
    expect(seen[0].url).toBe(cloudProxyV1Url('visor/machines'))
    expect(seen[0].method).toBe('POST')
    expect(JSON.parse(seen[0].body as string)).toMatchObject({ size: 'gpu-h100x1-80gb', dryRun: false })
  })

  it('quote POSTs a dryRun:true (no-spend) launch to the SAME address', async () => {
    stubFetch({ status: 'ok', data: { priceHourly: 2.5 } })
    await VisorApi.quote({ size: 'gpu-h100x1-80gb', region: 'nyc1', name: 'q' })
    expect(seen[0].url).toBe(cloudProxyV1Url('visor/machines'))
    expect(JSON.parse(seen[0].body as string)).toMatchObject({ dryRun: true })
  })

  it('terminate DELETEs the machine on the /v1 bearer BFF', async () => {
    stubFetch({})
    await VisorApi.terminate('abc-123')
    expect(seen[0].url).toBe(cloudProxyV1Url('visor/machines/abc-123'))
    expect(seen[0].method).toBe('DELETE')
  })
})

describe('filterSizes', () => {
  const mk = (slug: string, regions: string[] = []): VisorSize => ({ slug, available: true, regions })
  const sizes = [mk('s-1vcpu-1gb', ['nyc1', 'sfo3']), mk('s-2vcpu-4gb', ['sfo3']), mk('c-4-8gb', [])]

  it('filters by slug query (case-insensitive substring; blank = all)', () => {
    expect(filterSizes(sizes, 'S-2').map((s) => s.slug)).toEqual(['s-2vcpu-4gb'])
    expect(filterSizes(sizes, '   ').length).toBe(3)
  })

  it('filters by region, but never hides a size whose region list is unknown/empty', () => {
    expect(filterSizes(sizes, '', 'nyc1').map((s) => s.slug)).toEqual(['s-1vcpu-1gb', 'c-4-8gb'])
    expect(filterSizes(sizes, '', 'sfo3').map((s) => s.slug)).toEqual(['s-1vcpu-1gb', 's-2vcpu-4gb', 'c-4-8gb'])
  })

  it('combines query AND region', () => {
    expect(filterSizes(sizes, 's-', 'sfo3').map((s) => s.slug)).toEqual(['s-1vcpu-1gb', 's-2vcpu-4gb'])
  })
})
