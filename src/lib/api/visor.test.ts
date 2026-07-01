import { describe, expect, it } from 'vitest'

import { ApiError } from './client'
import {
  fmtSpec,
  interpretVisorError,
  normalizeGpuSize,
  normalizeMachine,
  normalizeRegion,
  normalizeSize,
  prettyGpuModel,
  statusVerdict,
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
})

describe('interpretVisorError — customer-appropriate, never infra jargon', () => {
  it('401/403 → sign in', () => {
    expect(interpretVisorError(new ApiError('no', 401)).kind).toBe('unauthorized')
    expect(interpretVisorError(new ApiError('no', 403)).kind).toBe('unauthorized')
  })

  it('404 / 501 / network → managed-compute, with NO infra-token wording', () => {
    for (const e of [new ApiError('x', 404), new ApiError('x', 501), new ApiError('x', 503), new Error('network')]) {
      const v = interpretVisorError(e)
      expect(v.kind).toBe('unavailable')
      expect(v.message.toLowerCase()).not.toContain('paas')
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

  it('normalizeGpuSize reads the nested gpu object + VRAM unit', () => {
    const g = normalizeGpuSize({
      slug: 'gpu-l40sx1-48gb', vcpus: 8, memoryMb: 65536, diskGb: 500, available: true, priceHourly: 1.57,
      gpu: { count: 1, model: 'nvidia_l40s', vram: 48, vramUnit: 'gib' },
    })
    expect(g).toMatchObject({ slug: 'gpu-l40sx1-48gb', vcpus: 8, memGb: 64, model: 'L40S', gpuCount: 1, vramGb: 48, priceHourly: 1.57 })
  })
})
