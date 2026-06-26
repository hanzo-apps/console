/**
 * Resource-name validation — a DNS-ish slug shared by every create form
 * (managed resources and clusters). One rule, one place.
 */
const SLUG = /^[a-z][a-z0-9-]{0,38}[a-z0-9]$/

/** Returns a human message if `v` is not a valid name, else null. */
export function slugError(v: string): string | null {
  if (v.length < 2 || v.length > 40) return 'Use 2–40 characters.'
  if (v.includes('--')) return 'No consecutive hyphens.'
  if (!SLUG.test(v))
    return 'Lowercase letters, numbers, hyphens; start with a letter, end alphanumeric.'
  return null
}
