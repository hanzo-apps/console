import { describe, expect, it } from 'vitest'

import { ApiError } from './client'
import { fmtSpec, interpretVisorError, normalizeMachine, statusVerdict } from './visor'

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
