/**
 * Org blend persistence — the per-org enabled-model set, stored on the ONE
 * OrgSettings row the org already owns.
 *
 * ┌─ ENDPOINT STATUS ──────────────────────────────────────────────────────────┐
 * │ TODO(hanzoai/ai): the OrgSettings row does not yet PERSIST the three blend  │
 * │ columns. Required, on the existing `/v1/ai/org/settings` GET + PUT noun      │
 * │ (no new endpoint — the row is the natural                                   │
 * │ home, beside routerPrefer/routerCostCeiling):                               │
 * │                                                                             │
 * │   enabledModels   string[] | null   allowlist; null/absent = inherit all    │
 * │   disabledModels  string[]          denylist, applied after the allowlist   │
 * │   customModels    {id,name,vendor,priceIn,priceOut}[]   bring-your-own      │
 * │                                                                             │
 * │ Semantics are arms.py `resolve_blend` (see ~/lib/models/blend.ts) — the     │
 * │ gateway's router must resolve them in the same enable→disable→add order.    │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * This client is NOT a stub: it reads the columns for real and writes them for real
 * through the existing read-modify-write contract, so it starts working the moment
 * the gateway persists them. Until then a write is DETECTED as dropped rather than
 * assumed to have worked — `save` re-reads the row and reports `persisted: false`
 * when the columns came back empty, and the module renders that honestly instead of
 * showing a saved blend that does not exist. A UI that cheerfully confirms a write
 * the backend discarded is worse than one that says it cannot save yet.
 *
 * Read-modify-write is mandatory (same reason as org-settings.ts): the backend
 * replaces the WHOLE row from the POST body, so every write carries the raw row
 * through unchanged and overrides only the three blend fields.
 */
import { originGet, originPut } from './client'
import type { BlendModel, BlendSpec } from '~/lib/models/blend'
import { INHERIT_ALL } from '~/lib/models/blend'

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** A string array field, or null when absent — `null` is meaningful (inherit all). */
function strList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Normalize one bring-your-own model row; returns null when it carries no usable id. */
function customModel(v: unknown): BlendModel | null {
  const r = asRecord(v)
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  if (!id) return null
  return {
    id,
    name: typeof r.name === 'string' ? r.name : undefined,
    vendor: typeof r.vendor === 'string' ? r.vendor : undefined,
    priceIn: num(r.priceIn),
    priceOut: num(r.priceOut),
  }
}

/** Parse an OrgSettings row into the blend spec it encodes. */
export function specFromRow(raw: unknown): BlendSpec {
  const r = asRecord(raw)
  return {
    enable: strList(r.enabledModels),
    disable: strList(r.disabledModels) ?? [],
    add: (Array.isArray(r.customModels) ? r.customModels : []).map(customModel).filter((m): m is BlendModel => m !== null),
  }
}

/** The three blend fields as they go on the wire. */
export function rowFromSpec(spec: BlendSpec): Record<string, unknown> {
  return {
    enabledModels: spec.enable,
    disabledModels: spec.disable,
    customModels: spec.add,
  }
}

/** True when a row carries any blend state at all — the persistence probe. */
export function rowHasBlend(raw: unknown): boolean {
  const r = asRecord(raw)
  return Array.isArray(r.enabledModels) || Array.isArray(r.disabledModels) || Array.isArray(r.customModels)
}

/** The org's blend plus whether the backend actually stores it. */
export type BlendState = {
  spec: BlendSpec
  /** False when the gateway has not yet persisted the blend columns (see TODO above). */
  persisted: boolean
}

export const OrgBlendApi = {
  /**
   * The org's blend. A missing row, or a row without the columns, reads as
   * INHERIT_ALL with `persisted: false` — the honest "nothing configured, and the
   * backend cannot hold it yet" state, never an invented allowlist.
   */
  get: async (owner: string): Promise<BlendState> => {
    const raw = await originGet<unknown>('org/settings', { owner })
    return { spec: specFromRow(raw), persisted: rowHasBlend(raw) }
  },

  /**
   * Write the org's blend, preserving every sibling field, then RE-READ to confirm
   * the columns survived. `persisted: false` means the write was accepted but
   * dropped — the caller must say so rather than claim success.
   */
  save: async (owner: string, spec: BlendSpec): Promise<BlendState> => {
    const current = await originGet<unknown>('org/settings', { owner })
    const row = { ...asRecord(current), owner, ...rowFromSpec(spec) }
    await originPut('org/settings', row, { owner })
    const after = await originGet<unknown>('org/settings', { owner })
    return { spec: specFromRow(after), persisted: rowHasBlend(after) }
  },

  /** Clear the override — back to inheriting the whole catalog. */
  reset: async (owner: string): Promise<BlendState> => OrgBlendApi.save(owner, INHERIT_ALL),
}
