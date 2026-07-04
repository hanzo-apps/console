/**
 * ProductLanding — PURE helpers (no UI, no I/O), unit-tested. Builds the real docs /
 * API / support links a landing rail and code samples point at, derived from the
 * brand docs host so a Lux/Zoo console links to ITS OWN surfaces (never hardcoded).
 */

/** Apex domain from a docs URL (https://docs.hanzo.ai → hanzo.ai). */
export function apexFromDocs(docsUrl: string): string {
  return docsUrl
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^docs\./, '')
    .trim()
}

/** The brand API base for code samples, e.g. https://api.hanzo.ai/v1. */
export function apiBaseFromDocs(docsUrl: string): string {
  return `https://api.${apexFromDocs(docsUrl)}/v1`
}

/**
 * A docs URL for a product, with an optional sub-path. The docs site serves every
 * product page under the `/docs/` prefix (a bare `docs.hanzo.ai/<slug>` 404s), so
 * the canonical form is `<docsHost>/docs/<product>[/<sub>]`.
 */
export function landingDocsUrl(docsUrl: string, product: string, sub?: string): string {
  const base = `${docsUrl.replace(/\/+$/, '')}/docs/${product}`
  return sub ? `${base}/${sub}` : base
}

/** The brand support mailbox derived from the docs host (docs.hanzo.ai → support@hanzo.ai). */
export function supportMailto(docsUrl: string): string {
  return `mailto:support@${apexFromDocs(docsUrl)}`
}

/** The standard doc links every product's resource rail shows. */
export interface StandardResources {
  docs: string
  quickstart: string
  examples: string
  api: string
}

export function standardResources(docsUrl: string, product: string): StandardResources {
  // The docs site is one page per product (Mintlify) — there are no separate
  // `/<product>/quickstart|examples|api-reference` sub-pages (they 404). So the
  // product's own docs page (which contains the quickstart + examples sections) is
  // the real target for those rows, and API Reference points at the real `/docs/api`.
  const page = landingDocsUrl(docsUrl, product)
  return {
    docs: page,
    quickstart: page,
    examples: page,
    api: `${docsUrl.replace(/\/+$/, '')}/docs/api`,
  }
}
