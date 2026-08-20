/**
 * The registry-bound assistant prompt — the thin wrapper that feeds the pure
 * builder (`prompt-content.ts`) the LIVE product catalog and the brand name, so the
 * console assistant is a genuine, current expert on the whole Hanzo suite.
 *
 * The catalog is generated from `visibleCatalogByCategory`, the SAME gate the nav
 * uses — so it is complete, stays current on its own, is white-labeled per brand,
 * and never points a customer at an admin-only page. The generation/formatting
 * logic lives in the pure module (unit-tested there); this file only maps the
 * registry shape onto the builder's minimal input.
 */
import { config } from '~/config'
import { visibleCatalogByCategory, CATEGORY_SUMMARY } from '~/lib/products/registry'
import { type Viewer, customer } from '~/lib/products/stage'
import {
  ASSISTANT_DOCS_STORE,
  buildAssistantPrompt,
  buildCommandBarPrompt,
  entryOpensAt,
  type PromptGroup,
} from './prompt-content'

export { ASSISTANT_DOCS_STORE } from './prompt-content'

export type AssistantPromptOptions = {
  /** Who is asking. Defaults to a plain customer, so the assistant never names a
   *  page the person cannot open — the SAME predicate the nav decides on. */
  viewer?: Viewer
}

/** The live catalog, scoped to what this viewer may see, projected onto the pure
 *  builder's minimal `PromptGroup[]` shape. */
function promptGroupsFor(viewer: Viewer): PromptGroup[] {
  return visibleCatalogByCategory(viewer).map(({ category, entries }) => ({
    category,
    summary: CATEGORY_SUMMARY[category],
    entries: entries.map((e) => ({
      id: e.id,
      label: e.label,
      description: e.description,
      opensAt: entryOpensAt(e),
    })),
  }))
}

/** The shared assistant system prompt — curated overview + the live product catalog
 *  + the honest-behavior contract. Used by the chat surfaces (floating bubble + full
 *  Chat page). */
export function hanzoAssistantSystemPrompt(opts: AssistantPromptOptions = {}): string {
  return buildAssistantPrompt(config.brandName, promptGroupsFor(opts.viewer ?? customer))
}

/** The ⌘K "Ask AI" variant — the same expert prompt plus the nav contract, so the
 *  command bar both JUMPS to a product on a clear intent and answers knowledgeably
 *  otherwise. Replaces the old nav-only prompt (one catalog, one source of truth). */
export function commandBarSystemPrompt(opts: AssistantPromptOptions = {}): string {
  return buildCommandBarPrompt(config.brandName, promptGroupsFor(opts.viewer ?? customer))
}
