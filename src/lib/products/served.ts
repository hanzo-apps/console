/**
 * What the platform says about its own products, and how a catalog row reads it.
 *
 * The console used to answer "does this product exist, what is it called, what is it for"
 * out of a hand-typed table that called itself the source of truth for a catalogue it does
 * not own. The platform owns it: `api.hanzo.ai/v1/openapi.json` is a projection of the
 * routers it mounted, so a tag in that document exists by construction, the tag IS the
 * `/v1` segment, and its one line is the owning package's own words. `scripts/sync-catalog.mjs`
 * reads it and writes `served.data.json`; this module is the only thing that reads that file.
 *
 * WHAT THE REGISTRY STILL DECLARES is the half the platform has no opinion about — which
 * module renders a route, the glyph, the order, how finished a surface is — plus a line of
 * its own for a page that answers no operation. A console surface is not a lesser product:
 * it is a view the platform never routed, so nobody upstream can describe it, and the row
 * that does is the only copy in the world.
 *
 * ONE FACT, ONE PLACE, in both directions, and `served.test.ts` holds both offline: a row
 * may not type a description the platform publishes, and a row the platform is silent about
 * must type one. Neither can be forgotten into existence.
 *
 * Pure and dependency-free — no React, no registry import — for the reason `stage.ts` and
 * `brand-scope.ts` are: the registry cannot be loaded under vitest at all (icon ESM), so
 * the projection is proved here over plain data and the React layer only supplies it.
 */
import record from './served.data.json'

/** What the platform publishes about one of its products. */
export type Served = {
  /** The owning package's own line. Empty when it wrote none. */
  description: string
  /** How many operations answer under it — the evidence that it exists. */
  operations: number
}

/** Every product the platform serves, by the `/v1` segment that names it. */
export const SERVED: Readonly<Record<string, Served>> = record.products

/** True when the platform answers operations under this id. The id IS the `/v1`
 *  segment, so this is also the answer to "is there a `/v1/<id>`". */
export const serves = (id: string): boolean => id in SERVED

/**
 * The name an id reads as: `api-keys` → `API Keys` is not derivable and `machines` →
 * `Machines` is, so a row types a label only where the plain rule gets it wrong (an
 * acronym, a name that is not its segment). Everything else has one spelling, here.
 */
export const nameOf = (id: string): string =>
  id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

/** What a catalog row must carry for the projection to read it. */
export type Declared = { id: string; label?: string; description?: string }

/** A row's display name — its own where it has one, else the name its id reads as. */
export const labelOf = (e: Declared): string => e.label ?? nameOf(e.id)

/**
 * A row's one line: the platform's words for a product it serves, the row's own for a
 * surface it does not. A served product whose package wrote no synopsis falls to the row
 * as well — a blank line under a nav item helps nobody, and the gap is printed every sync
 * so it can be closed where it belongs, in the owning package.
 */
export const lineOf = (e: Declared): string => SERVED[e.id]?.description || e.description || ''
