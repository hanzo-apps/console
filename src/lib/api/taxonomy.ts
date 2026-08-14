/**
 * The product taxonomy — the catalogue as an editable, multi-tenant service
 * (`GET /v1/taxonomy`) rather than an array compiled into this bundle.
 *
 * WHAT THE CALLER GETS BACK IS NOT THE SAME DOCUMENT FOR EVERYONE, and that is
 * the whole reason this module holds no cache.
 *
 * The response varies along TWO axes at once:
 *
 *   • the ORG — the platform's rows (owner `hanzo`) plus the caller's own, and
 *     never another customer's. Where the caller's org and the platform share an
 *     id, the caller's row is the one served.
 *   • the WRITE AUTHORITY — an unpublished row is served only to whoever may
 *     unstage it, so a member and an admin of the SAME org get different
 *     documents.
 *
 * So a response is keyed by identity, not by URL. A module-level `let cache` here
 * — the obvious optimisation, and the one this comment exists to refuse — would
 * hand the second caller the first caller's catalogue: one tenant's private rows
 * rendered in another tenant's console, or a member shown a row staged by an
 * admin. There is NO key available in this process that is safe to cache under:
 * the browser never learns its own org from this call (identity is minted
 * server-side from the session and stripped off anything the client sends), so
 * any key we could compute here is a guess about who we are.
 *
 * The read is cheap and the correct answer is therefore the plain one: fetch it,
 * per caller, per mount. The ANONYMOUS response — the platform catalogue alone,
 * what the marketing landing renders — is genuinely shared and may be cached by
 * whatever serves that page; that is a decision for a surface with no session,
 * not for this client, which only ever runs where there is one.
 *
 * Brand is applied SERVER-side via `?brand=`: the categories that brand admits,
 * and within them the taxa scoped to it. Filtering again here would be a second
 * copy of a rule that already has a home.
 */
import { restGet, originV1Url } from './client'

/** One product in the catalogue: what it is called, where it sits, how it opens. */
export type Taxon = {
  /**
   * The org this row belongs to — the platform's own org for a product every
   * tenant sees, or your org for one you added. It is how a console decides which
   * rows it may offer to EDIT without asking a second question: a row whose owner
   * is not yours is not yours to change.
   */
  owner: string
  /** Stable slug, e.g. `vector`. Unique per owner, not globally. */
  id: string
  /** Display name, e.g. `Vector`. */
  name: string
  /** The one line shown beneath the name. */
  description: string
  /** Id of the category this is filed under. */
  category: string
  /** Free-form labels for search and grouping across categories. */
  tags?: string[]
  /** The icon's NAME, e.g. `Database` — which set draws it is this surface's business. */
  icon?: string
  /** In-console path, e.g. `/vector`. Set for a product the console renders itself. */
  route?: string
  /** Absolute URL an external product launches. Set instead of `route`. */
  href?: string
  /** Brands whose console shows this. Absent means every brand its category admits. */
  brands?: string[]
  /** Position within its category, ascending. */
  order: number
  /** Whether it is shown. An unpublished row reaches only an editor. */
  published: boolean
}

/** One grouping of products — a section of the nav. */
export type Category = {
  /** The org this category belongs to. Same rule as a taxon's. */
  owner: string
  /** Stable slug, e.g. `observe`. */
  id: string
  /** Display name, e.g. `Observe`. */
  label: string
  /** The one line describing what it groups. */
  summary: string
  /** Position among its siblings, ascending. */
  order: number
  /** Brands whose console shows it. Absent means every brand. */
  brands?: string[]
  /** The products filed under it, in display order. */
  taxa: Taxon[]
}

/** The whole catalogue: categories in display order, each carrying its taxa. */
export type Taxonomy = { categories: Category[] }

/**
 * Read the catalogue this caller may see, narrowed to one brand's console.
 *
 * It resolves to the platform's rows plus the caller's own. It REJECTS when the
 * service cannot be reached — the caller decides what an unreachable catalogue
 * means for its screen, because "no answer" and "an empty catalogue" are
 * different facts and only the caller knows which one it can render.
 */
export const fetchTaxonomy = (brand: string): Promise<Taxonomy> =>
  restGet<Taxonomy>(`${originV1Url('taxonomy')}?brand=${encodeURIComponent(brand)}`)
