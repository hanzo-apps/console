/**
 * How finished a surface is, and who that admits — the ONE axis the console
 * decides visibility on.
 *
 * Before this there were three unrelated notions of "allowed" and each surface
 * picked its own: a boolean `admin` on the entry, the entitlement set (money —
 * see below), and the per-brand category scope. Nothing composed them, so the nav
 * rail, ⌘K, All-products, the home map and the category pages each answered the
 * question slightly differently and drifted apart one commit at a time.
 *
 * FOUR STAGES, ONE FIELD.
 *   ga    — finished. Everyone.
 *   beta  — usable, not finished. Hidden until the ORG opts in (see below).
 *   alpha — not ready to be found. Never listed; still resolves for someone who
 *           already knows the address.
 *   admin — the platform operator's own surfaces. MEMBERSHIP of the reserved
 *           `admin` org, never a toggle: no customer can opt into it, and it is
 *           the only stage the router withholds.
 *
 * TWO QUESTIONS, NOT ONE. Listing and resolving are different decisions and
 * braiding them is what turns a hidden product into a 404:
 *   `listed`    — does this appear in a list a person browses?
 *   `reachable` — does this address render when typed?
 * Everything except `admin` resolves at its own address for anyone, because
 * hiding is a nav decision. `admin` is withheld at both, because it is the one
 * stage backed by an identity the server also enforces.
 *
 * NOT MONEY. The entitlement set (`~/lib/entitlements`) answers a different
 * question — what the org's plan grants — against a live, commerce-gated backend.
 * It stays exactly where it is and composes after this; a stage is about the
 * PRODUCT, an entitlement is about the ACCOUNT.
 *
 * Pure and dependency-free (no React, no registry import) for the reason
 * `brand-scope.ts` is: the registry cannot be loaded under vitest at all (icon
 * ESM), so the decision is proved here over plain data.
 */

/** How finished a product or one of its sub-pages is. */
export type Stage = 'ga' | 'beta' | 'alpha' | 'admin'

/** Who is looking — the two facts a stage is weighed against. */
export type Viewer = {
  /** Member of the reserved `admin` org (`owner === 'admin'`). Membership, not a
   *  preference: there is no path by which a customer sets this. */
  admin: boolean
  /** The org opted into pre-GA products. One org-wide switch, set in Settings by
   *  an org admin, and deliberately unadvertised anywhere else. */
  beta: boolean
}

/** The platform operator: every stage. Also the default where a call is asking
 *  which tabs a product HAS rather than making a nav decision. */
export const operator: Viewer = { admin: true, beta: true }

/** A new account, out of the box: GA only. */
export const customer: Viewer = { admin: false, beta: false }

/** An entry's stage. Unset is `ga`, so a product is finished unless it says
 *  otherwise — the alternative hides work nobody remembered to classify. */
export const stageOf = (x: { stage?: Stage }): Stage => x.stage ?? 'ga'

/**
 * Does this stage appear in a list this viewer browses — the nav rail, ⌘K,
 * All-products, the home map, a category page?
 *
 * The operator sees every stage. Everyone else sees GA, plus beta once their org
 * has opted in. `alpha` is listed for nobody: it is reachable by address and
 * nothing else, which is the whole point of the stage.
 */
export const listed = (s: Stage, v: Viewer): boolean =>
  v.admin || s === 'ga' || (s === 'beta' && v.beta)

/**
 * Does this stage render when its address is typed?
 *
 * Yes for everything but `admin`. A product hidden from the nav is still a real
 * product: a bookmark, a support link, or a colleague's URL must open it, and an
 * opt-in that the customer already made must not be undone by an address bar.
 * `admin` is the exception because it is membership — the server refuses it too,
 * and rendering the honest "managed by Hanzo" notice beats a hostile 403.
 */
export const reachable = (s: Stage, v: Viewer): boolean => v.admin || s !== 'admin'
