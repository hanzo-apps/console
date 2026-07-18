'use client'

/**
 * Base — manage your organization's Hanzo Base instances.
 *
 * Hanzo Base is a realtime backend (hanzoai/base): content types, records, and
 * auth, per Base. This module is a thin route adapter; the whole surface — the
 * Bases list, the New Base create flow, and per-Base configuration — lives in the
 * reusable `BasesManager`. There is ONE Base binding: console2's OWN `/superbase`
 * proxy, which mints the user's IAM bearer and stamps `X-Org-Id` from the JWT
 * owner, so every read/write is scoped to this org. Each Base is a row in the
 * SuperBase orchestrator's `tenants` collection; we drive its real API, we do not
 * re-implement Base. (A Base's own data — collections + records — is the sibling
 * `Records` product.)
 *
 * Routes (declared in the registry, resolved by segment):
 *   /base · /base/new · /base/:base
 */
import { BasesManager } from './base/BasesManager'

export function BaseModule({ params }: { params: Record<string, string> }) {
  return <BasesManager params={params} />
}

