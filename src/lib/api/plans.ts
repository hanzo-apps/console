/**
 * Plans & pricing API — the public cloud rate card (hanzoai/cloud plansvc).
 *
 * Contract (plain REST, no casibase envelope):
 *   GET /v1/pricing -> { cloud: { plans: CloudPlan[], blockStorage } }
 *   GET /v1/plans   -> { plans: CloudPlan[] }
 *
 * This is read-only discovery data — what each tier offers and costs — so the
 * console can guide a user from "what can I run" to "what will it cost" without
 * reimplementing the money surface: actually paying happens at `config.billingUrl`
 * (hanzoai/billing over the commerce backend). No auth, no tenancy: the rate card
 * is the same for everyone.
 */
import { restGet, v1Url } from './client'

/** One cloud compute tier as published by the rate card. */
export type CloudPlan = {
  id: string
  name: string
  category: string
  description: string
  /** 'shared' or 'dedicated' vCPU. */
  cpuType: string
  vcpus: number
  memoryGB: number
  diskGB: number
  transferTB?: number
  maxVMs: number
  priceMonthly: number
  priceHourly?: number
  centsPerHour?: number
  /** Human-readable bullets (present on the /v1/pricing surface). */
  features?: string[]
  /** Tier includes a free allowance. */
  freeTier?: boolean
  /** Editorially highlighted tier. */
  popular?: boolean
}

/** Metered block-storage pricing (added to a plan). */
export type BlockStoragePricing = {
  minSizeGB: number
  maxSizeGB: number
  pricePerGBMonthly: number
}

/** The /v1/pricing response — the rate card plus add-on metering. */
export type CloudPricing = {
  cloud: {
    plans: CloudPlan[]
    blockStorage?: BlockStoragePricing
  }
}

export const PlansApi = {
  /** Full rate card (plans + block-storage metering) — the richer surface. */
  pricing: () => restGet<CloudPricing>(v1Url('pricing')),
  /** Plans only (thinner; pricing() is preferred for display). */
  list: () => restGet<{ plans: CloudPlan[] }>(v1Url('plans')),
}
