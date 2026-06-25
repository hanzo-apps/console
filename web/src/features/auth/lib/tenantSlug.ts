/**
 * Deterministic per-tenant organization slug — the ONE place a self-serve
 * tenant's email is turned into a stable IAM/console organization id.
 *
 * One tenant = one slug = one IAM org = one console org = one commerce
 * namespace. The slug must satisfy BOTH:
 *   - IAM's `FieldValidationFilter` (rejects any `name` containing
 *     `/?:#&%=+;`), and
 *   - IAM's `ReUserName` org/name regex `^[a-zA-Z0-9]+([-._][a-zA-Z0-9]+)*$`
 *     (lowercase alphanumerics, single internal `-`/`.`/`_`, no leading/
 *     trailing separator, no consecutive separators).
 *
 * So we lowercase the email, map every non-`[a-z0-9]` run to a single `-`,
 * trim separators, and append a short deterministic hash suffix of the full
 * email so two visually-colliding locals (`a.b@x` vs `a-b@x`) never share an
 * org. Pure + env-free so it can be unit-tested in isolation.
 */
import { createHash } from "crypto";

/** Max length for the human-readable stem (keeps the full slug well under IAM's 255). */
const STEM_MAX = 32;

/**
 * 16 hex chars (64 bits) of SHA-256 — matches IAM's own `orgSlug` suffix width.
 * 64 bits keeps the birthday-collision probability negligible across any
 * realistic tenant count (a collision would merge two humans into one org =
 * one commerce billing namespace, so this MUST be collision-safe, not just
 * "usually distinct").
 */
function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Build the canonical tenant slug for an email. Deterministic: the same email
 * always yields the same slug (so re-running signup is idempotent).
 */
export function tenantSlugForEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const stem = normalized
    .replace(/[^a-z0-9]+/g, "-") // every illegal run → single hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .replace(/-{2,}/g, "-") // collapse (defensive; the run-replace already does)
    .slice(0, STEM_MAX)
    .replace(/-+$/g, ""); // a trailing hyphen may reappear after the slice
  const base = stem.length > 0 ? stem : "tenant";
  // Always suffix with a hash of the FULL email so distinct emails that
  // normalize to the same stem get distinct slugs, and the stem stays readable.
  return `${base}-${shortHash(normalized)}`;
}
