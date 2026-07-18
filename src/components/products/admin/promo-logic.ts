/**
 * Pure, unit-tested helpers for the platform-promo editor. No React, no I/O — every
 * value is DERIVED from the real `PlatformPromo` the `/v1/admin/promos` surface returns.
 *
 * Dates are handled in UTC by construction: the `<input type="datetime-local">` value is
 * read as UTC (minute precision), so the round-trip is deterministic and unambiguous for
 * a platform-config tool (no hidden local-timezone shift), and testable without a clock.
 */
import type { PlatformPromo } from '~/lib/api/admin-promos'

/** The raw promo form fields (all strings/bools/number as edited). */
export type PromoForm = {
  percentOff: number
  /** `<input type="datetime-local">` value (`YYYY-MM-DDTHH:mm`, UTC) or ''. */
  start: string
  end: string
  /** Comma/newline-separated paid plan ids; '' = all paid plans. */
  plans: string
  active: boolean
}

/**
 * An RFC3339/ISO instant → the `YYYY-MM-DDTHH:mm` a `datetime-local` input shows (UTC,
 * minute precision). A non-parseable / empty value → '' (the control shows blank).
 */
export function toDatetimeLocal(rfc3339?: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec((rfc3339 ?? '').trim())
  return m ? `${m[1]}T${m[2]}` : ''
}

/**
 * A `datetime-local` value (`YYYY-MM-DDTHH:mm[:ss]`) → an RFC3339 UTC instant
 * (`...:ssZ`). Empty → ''. A malformed value → '' (the caller treats it as invalid).
 */
export function fromDatetimeLocal(local: string): string {
  const s = (local ?? '').trim()
  if (s === '') return ''
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(s)
  return m ? `${m[1]}T${m[2]}:${m[3] ?? '00'}Z` : ''
}

/** Parse a comma/newline plan list → trimmed, de-duped, non-empty ids (order preserved). */
export function parsePlans(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of (text ?? '').split(/[,\n]/)) {
    const p = raw.trim()
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out
}

/** plans[] → the comma-separated text the field edits. */
export const plansToText = (plans: string[]): string => plans.join(', ')

/** True iff the promo carries any real configuration (i.e. it is not the unset zero). */
export const promoIsSet = (p: PlatformPromo): boolean =>
  p.percentOff > 0 || p.plans.length > 0 || p.active || p.start !== '' || p.end !== ''

/** A one-line human summary of the live promo state, for the "current state" card. */
export function promoSummary(p: PlatformPromo): string {
  if (!promoIsSet(p)) return 'No promo configured'
  return [`${p.percentOff}% off`, p.plans.length ? p.plans.join(', ') : 'all paid plans', p.active ? 'active' : 'inactive'].join(
    ' · ',
  )
}

/** A validated upsert payload or a human error message. */
export type PromoValidation = { ok: true; body: PlatformPromo } | { ok: false; error: string }

/** Validate + coerce the promo form at the boundary (percent 0–100, valid + ordered dates). */
export function validatePromoForm(form: PromoForm): PromoValidation {
  const percentOff = Math.round(form.percentOff)
  if (!Number.isFinite(percentOff) || percentOff < 0 || percentOff > 100) {
    return { ok: false, error: 'Percent off must be between 0 and 100.' }
  }
  const start = fromDatetimeLocal(form.start)
  if (form.start.trim() !== '' && start === '') return { ok: false, error: 'Start is not a valid date/time.' }
  const end = fromDatetimeLocal(form.end)
  if (form.end.trim() !== '' && end === '') return { ok: false, error: 'End is not a valid date/time.' }
  // RFC3339 UTC strings are fixed-width, so a lexical compare IS a chronological one.
  if (start !== '' && end !== '' && end <= start) return { ok: false, error: 'End must be after start.' }
  return { ok: true, body: { percentOff, start, end, plans: parsePlans(form.plans), active: form.active } }
}

/** Pre-fill the form from a live promo. */
export function formForPromo(p: PlatformPromo): PromoForm {
  return {
    percentOff: p.percentOff,
    start: toDatetimeLocal(p.start),
    end: toDatetimeLocal(p.end),
    plans: plansToText(p.plans),
    active: p.active,
  }
}
