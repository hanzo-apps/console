/**
 * Plans & pricing — the published subscription catalog (the money-truth rate card
 * that actually gets charged), read through the console's OWN per-tenant billing
 * proxy at the canonical GET /v1/billing/plans -> commerce api/billing.ListPlans.
 *
 * Why the billing proxy, not /v1/pricing or /v1/plan: the billing proxy injects the
 * commerce SERVICE token server-side (the SAME proxy every working billing call uses —
 * balance, usage, subscriptions), whereas the old /v1/pricing read rendered "Not
 * authorized" and NO tiers — nobody could see or buy Pro. So the catalog loads for a
 * signed-in user. Read-only
 * discovery: actually paying happens at config.billingUrl (the brand billing portal
 * over commerce, Square checkout), which the cards link to — one money surface, never
 * reimplemented here.
 *
 * Wire shape (commerce `staticPlan` — a BARE ARRAY, prices in CENTS):
 *   [{ slug, name, description, category, price, priceAnnual, currency, interval,
 *      trialPeriodDays, popular?, contactSales?, features?, limits? }]
 * normalized here to a display `Plan` with whole-dollar prices.
 */
import { restGet, billingProxyV1Url } from './client'

/** Per-tier rate limits / allotments as the catalog publishes them (all optional-safe). */
export type PlanLimits = {
  requestsPerMinute?: number
  tokensPerMinute?: number
  /** One-time free credit the tier includes (whole USD). */
  freeCredit?: number
  maxMembers?: number
  /** Recurring monthly cloud-credit allowance (whole USD). */
  includedCloudCredits?: number
  includedCloudCreditsPerUser?: number
}

/** One subscription tier for display (whole-dollar prices). */
export type Plan = {
  /** Stable plan slug (commerce `slug`), e.g. "pro". */
  id: string
  name: string
  description: string
  /** 'personal' | 'team' | 'enterprise' — the cloud account tiers shown here. */
  category: string
  /** Monthly price in whole USD dollars (0 = free). */
  priceMonthly: number
  /** Annual price in USD dollars per month (billed annually), if offered. */
  priceAnnual?: number
  /** Ledger currency (lowercase ISO), e.g. 'usd'. */
  currency: string
  /** Base free-trial length advertised for the plan, if any. */
  trialPeriodDays?: number
  /** Editorially highlighted tier (Pro). */
  popular?: boolean
  /** Quote/negotiated tier — no self-serve price (Enterprise / Custom). */
  contactSales?: boolean
  /** Published feature bullets. */
  features: string[]
  limits?: PlanLimits
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
/** Whole USD dollars from a CENTS integer (commerce is cents end-to-end). */
const dollars = (cents: number | undefined): number => Math.round(cents ?? 0) / 100

/**
 * The account-tier categories shown on the cloud Plans page — the Hanzo Cloud
 * subscription tiers a user upgrades their account to. The catalog ALSO carries
 * separate product lines (world / social / dns) served on their own surfaces, so
 * they are filtered out of the "upgrade your cloud account" grid.
 */
const ACCOUNT_CATEGORIES = new Set(['personal', 'team', 'enterprise'])
/** Fixed display order for the account tiers. */
const CATEGORY_ORDER = ['personal', 'team', 'enterprise']
/** A tier priced at/above this (USD/mo) is a quote — no self-serve checkout (mirrors
 *  the brand billing portal's own price>=9999 rule); Enterprise sits here. */
const CONTACT_SALES_MIN = 9999

/** Roll one commerce `staticPlan` record into the display `Plan` (cents -> dollars). */
function normalizePlan(r: Record<string, unknown>): Plan {
  const priceMonthly = dollars(num(r.price))
  const l = (r.limits && typeof r.limits === 'object' ? r.limits : {}) as Record<string, unknown>
  const annual = num(r.priceAnnual)
  return {
    id: str(r.slug) || str(r.id),
    name: str(r.name),
    description: str(r.description),
    category: str(r.category),
    priceMonthly,
    priceAnnual: annual !== undefined ? dollars(annual) : undefined,
    currency: (str(r.currency) || 'usd').toLowerCase(),
    trialPeriodDays: num(r.trialPeriodDays),
    popular: r.popular === true,
    contactSales: r.contactSales === true || priceMonthly >= CONTACT_SALES_MIN,
    features: Array.isArray(r.features) ? r.features.filter((f): f is string => typeof f === 'string') : [],
    limits: {
      requestsPerMinute: num(l.requestsPerMinute),
      tokensPerMinute: num(l.tokensPerMinute),
      freeCredit: num(l.freeCredit),
      maxMembers: num(l.maxMembers),
      includedCloudCredits: num(l.includedCloudCredits),
      includedCloudCreditsPerUser: num(l.includedCloudCreditsPerUser),
    },
  }
}

/** Rank a plan within its category: a contact-sales tier (no self-serve price) sorts last. */
const rank = (p: Plan): number => (p.contactSales ? Number.MAX_SAFE_INTEGER : p.priceMonthly)

/**
 * Order the account tiers for display: by category (personal -> team -> enterprise),
 * then cheapest-first within a category (Developer, Pro, Max / Team, Team Max /
 * Enterprise, Custom). Stable, so the free tier leads and Pro sits where a user scans.
 */
function orderPlans(a: Plan, b: Plan): number {
  const ci = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  return ci !== 0 ? ci : rank(a) - rank(b)
}

export const PlansApi = {
  /**
   * The published cloud account subscription tiers (Developer / Pro / Max / Team /
   * Enterprise / Custom), through the per-tenant billing proxy. World/social/DNS
   * product plans are filtered out; the result is ordered for the upgrade grid.
   */
  plans: async (): Promise<Plan[]> => {
    const raw = await restGet<unknown>(billingProxyV1Url('plans'))
    const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
    return rows
      .map(normalizePlan)
      .filter((p) => ACCOUNT_CATEGORIES.has(p.category))
      .sort(orderPlans)
  },
}
