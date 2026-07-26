/**
 * Startup Program pipeline as a Base view — the applications resource
 * (`/v1/crm/applications`) expressed as a `FieldDefinition[]` schema + a pure
 * record mapper, rendered by the SAME @hanzo/data `RecordsView` (table ⇆ board)
 * the CRM uses. The `stage` select drives the pipeline BOARD lanes
 * (applied → screened → qualified → credits-offered → onboarded → rejected); the
 * card surfaces the AI score, the tier-1 flag, and the suggested credits.
 *
 * Pure (no React, no I/O): schema + mapper in, records out. The full Application
 * is stashed on the record (`__app`) so the detail drawer has the AI screen,
 * draft reply, timeline, and every submitted field without a second fetch.
 */
import type { FieldDefinition, SelectOption, TagColor } from '@hanzo/data'
import { STARTUP_STAGES, type Application } from '~/lib/api/startups'

const STAGE_LABEL: Record<string, string> = {
  applied: 'Applied',
  screened: 'Screened',
  qualified: 'Qualified',
  'credits-offered': 'Credits offered',
  onboarded: 'Onboarded',
  rejected: 'Rejected',
}

// Monochrome-leaning: the early, non-semantic stages read neutral (gray); the later
// stages keep a restrained progression cue toward the terminal states.
const STAGE_COLOR: Record<string, TagColor> = {
  applied: 'gray',
  screened: 'gray',
  qualified: 'teal',
  'credits-offered': 'amber',
  onboarded: 'green',
  rejected: 'gray',
}

/** The pipeline stage options (drives the select cell + the board lanes). */
export const STARTUP_STAGE_OPTIONS: SelectOption[] = STARTUP_STAGES.map((s) => ({
  value: s,
  label: STAGE_LABEL[s] ?? s,
  color: STAGE_COLOR[s] ?? 'gray',
}))

const secToMs = (s: number): number | null => (s ? s * 1000 : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

// ── schema ────────────────────────────────────────────────────────────────────
export const STARTUP_FIELDS: FieldDefinition[] = [
  { name: 'company', label: 'Company', type: 'text', width: 200 },
  { name: 'stage', label: 'Stage', type: 'select', width: 160, metadata: { options: STARTUP_STAGE_OPTIONS } },
  { name: 'score', label: 'AI score', type: 'number', width: 100 },
  { name: 'tier1', label: 'Tier-1', type: 'boolean', width: 90 },
  { name: 'credits', label: 'Suggested', type: 'currency', width: 150, metadata: { currencyCode: 'USD' } },
  { name: 'contact', label: 'Contact', type: 'text', width: 180 },
  { name: 'fundingStage', label: 'Funding', type: 'text', width: 120 },
  { name: 'website', label: 'Website', type: 'url', width: 200 },
  { name: 'createdAt', label: 'Applied', type: 'dateTime', width: 170, readOnly: true },
]

// ── record mapper (Application → @hanzo/data record) ──────────────────────────
export function applicationRecord(a: Application): Record<string, unknown> {
  const scored = a.screen.status === 'done'
  return {
    id: a.id,
    company: a.company || '(unnamed)',
    stage: a.stage,
    score: scored ? a.screen.score : null,
    tier1: a.tier1,
    credits: { amount: a.screen.suggestedCredits, currencyCode: 'USD' },
    contact: a.contactName || a.email || '—',
    fundingStage: str(a.metadata.fundingStage),
    website: a.website,
    createdAt: secToMs(a.createdAt),
    // Full application stashed for the detail drawer (not a column).
    __app: a,
  }
}
