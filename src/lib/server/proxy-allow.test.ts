import { describe, expect, it } from 'vitest'

import {
  allowCloudSurface,
  allowVisorSurface,
  allowCommerceSurface,
  v1Head,
  CLOUD_HEADS,
  COMMERCE_HEADS,
} from './proxy-allow'

describe('v1Head', () => {
  it('extracts the head of a v1 path', () => {
    expect(v1Head('v1/vector')).toBe('vector')
    expect(v1Head('v1/vector/mydb')).toBe('vector')
    expect(v1Head('v1/functions/foo/logs')).toBe('functions')
    expect(v1Head('/v1/kv')).toBe('kv') // tolerant of a leading slash
  })

  it('returns null for a non-v1 path', () => {
    expect(v1Head('vector')).toBeNull()
    expect(v1Head('')).toBeNull()
  })
})

describe('allowCloudSurface', () => {
  it('admits every managed data kind and serverless surface', () => {
    for (const head of CLOUD_HEADS) {
      expect(allowCloudSurface(`v1/${head}`)).toBe(true)
      expect(allowCloudSurface(`v1/${head}/some-name`)).toBe(true)
    }
  })

  it('admits the functions/prompts/agents subtrees', () => {
    expect(allowCloudSurface('v1/functions/metrics')).toBe(true)
    expect(allowCloudSurface('v1/prompts/my-prompt')).toBe(true)
    expect(allowCloudSurface('v1/agents/agent-1/runs')).toBe(true)
  })

  it('admits the evals facade (scores/datasets/dataset-items/evaluators/runs)', () => {
    expect(CLOUD_HEADS).toContain('evals')
    for (const sub of ['scores', 'datasets', 'dataset-items', 'evaluators', 'runs']) {
      expect(allowCloudSurface(`v1/evals/${sub}`)).toBe(true)
    }
    // the bare head + a query-less path both admit
    expect(allowCloudSurface('v1/evals')).toBe(true)
  })

  it('admits the prompts metrics + detail sub-paths (the AI surface heads)', () => {
    expect(allowCloudSurface('v1/prompts/metrics')).toBe(true)
    expect(allowCloudSurface('v1/prompts/support-triage')).toBe(true)
  })

  it('REFUSES privileged / unlisted cloud-api surfaces (not a general tunnel)', () => {
    expect(allowCloudSurface('v1/iam/get-users')).toBe(false)
    expect(allowCloudSurface('v1/admin/overview')).toBe(false)
    expect(allowCloudSurface('v1/kms/secrets')).toBe(false)
    expect(allowCloudSurface('v1/get-account')).toBe(false)
    expect(allowCloudSurface('functions')).toBe(false) // must be a v1 path
  })
})

describe('allowVisorSurface', () => {
  it('admits the whole visor v1 subtree', () => {
    expect(allowVisorSurface('v1')).toBe(true)
    expect(allowVisorSurface('v1/machines')).toBe(true)
    expect(allowVisorSurface('v1/regions')).toBe(true)
    expect(allowVisorSurface('v1/gpus/gpu-1')).toBe(true)
  })

  it('refuses anything outside v1', () => {
    expect(allowVisorSurface('admin/machines')).toBe(false)
    expect(allowVisorSurface('v2/machines')).toBe(false)
    expect(allowVisorSurface('')).toBe(false)
  })
})

describe('allowCommerceSurface', () => {
  it('admits every merchant store head', () => {
    for (const head of COMMERCE_HEADS) {
      expect(allowCommerceSurface(`v1/${head}`)).toBe(true)
      expect(allowCommerceSurface(`v1/${head}/some-id`)).toBe(true)
    }
  })

  it('refuses the money / tenant-admin surfaces that share the commerce binary', () => {
    // Billing rides its OWN scoped `/billing` proxy; checkout + tenant-admin are off-limits.
    expect(allowCommerceSurface('v1/billing/balance')).toBe(false)
    expect(allowCommerceSurface('v1/checkout/sessions')).toBe(false)
    expect(allowCommerceSurface('v1/namespace')).toBe(false)
    expect(allowCommerceSurface('_/commerce/tenants')).toBe(false)
    expect(allowCommerceSurface('product')).toBe(false) // must be a v1 path
  })
})
