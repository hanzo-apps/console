import { describe, expect, it } from 'vitest'

import { CLOUD_HEADS, COMMERCE_HEADS } from './proxy-allow'

/**
 * Canonical-alignment guard for the same-origin proxy allow-lists.
 *
 * The capability manifest (hanzoai/openapi · CAPABILITIES.md) is authoritative:
 * one canonical name per capability, and a fixed set of INTERNAL trust boundaries
 * that have NO public API surface. A same-origin `/v1/<head>` proxy must never
 * become a tunnel to either the platform's internal infra or its privileged
 * identity/admin/secrets surfaces — those reach the console (if at all) only
 * through their OWN scoped, gated proxies, never the generic user-bearer `/v1`.
 *
 * This test pins that boundary so a future edit can't silently widen an
 * allow-list to a forbidden head.
 */

// Internal infrastructure — NOT public capabilities (CAPABILITIES.md "Internal").
// Trust boundaries / runtime hosts with no mountable public surface.
const INTERNAL_ONLY = ['principal', 'goja', 'mpc', 'controlplane'] as const

// Privileged surfaces the `/v1` user-bearer proxy must never reach (per the
// proxy-allow.ts security contract: "`/v1` must never reach `v1/iam/*` or admin
// endpoints"). Secrets (kms) and the SuperAdmin god view (admin) are cross-tenant
// or high-blast-radius and are gated elsewhere.
const FORBIDDEN_HEADS = ['iam', 'admin', 'kms', ...INTERNAL_ONLY] as const

describe('proxy allow-lists · canonical alignment', () => {
  it('CLOUD_HEADS admits no internal-infra or privileged head', () => {
    for (const forbidden of FORBIDDEN_HEADS) {
      expect(CLOUD_HEADS, `CLOUD_HEADS must not admit "${forbidden}"`).not.toContain(forbidden)
    }
  })

  it('COMMERCE_HEADS admits no internal-infra or privileged head', () => {
    for (const forbidden of FORBIDDEN_HEADS) {
      expect(COMMERCE_HEADS, `COMMERCE_HEADS must not admit "${forbidden}"`).not.toContain(forbidden)
    }
  })

  it('every allow-listed head is a non-empty, lowercase, single URL segment', () => {
    for (const head of [...CLOUD_HEADS, ...COMMERCE_HEADS]) {
      expect(head, `"${head}" must be a clean single path segment`).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    }
  })

  it('allow-lists are duplicate-free (one entry per head)', () => {
    expect(new Set(CLOUD_HEADS).size).toBe(CLOUD_HEADS.length)
    expect(new Set(COMMERCE_HEADS).size).toBe(COMMERCE_HEADS.length)
  })
})
