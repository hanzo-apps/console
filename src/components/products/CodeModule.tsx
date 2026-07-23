'use client'

/**
 * Code — the unified Code hub (Dev): all our code in ONE place, over the native git host
 * (`/v1/git`) and the code-intelligence engine (`/v1/code`). This is the thin routing
 * dispatcher; the surfaces live in `code/` + the reused `git/` browser:
 *
 *   /code               → the hub, default tab Repositories        (CodeHub, tab='repos')
 *   /code/:tab          → Repositories | Search | Ask               (CodeHub)
 *   /code/repos/:name   → the repo browser (tree · blob · commits)  (RepoBrowser)
 *
 * The former standalone Code (search + ask) is folded in as the hub's Search/Ask faces,
 * and the former Git product is folded in as the Repositories face + the repo browser —
 * one Dev "Code" product, one nav entry, no duplication. Org-scoped SERVER-SIDE, so it is
 * brand-agnostic: every brand's console shows ITS OWN org's repos, no cross-brand leak.
 */
import { RepoBrowser } from './git/RepoBrowser'
import { CodeHub } from './code/CodeHub'
import { canonicalTab } from './code/hub-logic'

export function CodeModule({ params }: { params: Record<string, string> }) {
  // `repos/:name` → the deep repo browser; everything else → the hub at the given tab.
  if (params.name) return <RepoBrowser name={params.name} />
  return <CodeHub tab={canonicalTab(params.tab)} />
}
