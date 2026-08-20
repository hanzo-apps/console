'use client'

/**
 * The brief — one row at the top of every product page that hands the product on
 * screen to an agent.
 *
 * Mounted ONCE, in the shared content column (`~/entry/dashboard`), so all 186
 * products have it and no product module knows it exists. It is a route-dependent
 * LEAF for the same reason `ProductGuide` and `BreadcrumbsBar` are: it owns its own
 * `usePathname()`, so the shell never subscribes to the address and stays inert
 * across navigation.
 *
 * Two affordances, one text:
 *  - **Copy brief** — the brief on the clipboard, for an agent anywhere else.
 *  - **Ask AI** — the same brief seeded into the console's own assistant composer,
 *    which the reader then sends. Never an auto-send (`useFloatingChat().ask`'s
 *    contract), and the same name the Code hub already gives this affordance.
 *
 * The text itself is composed, never written: identity from the catalog record, the
 * console addresses from the router, the operations from the API's own command
 * projection. It carries no credential — it names a bearer and where to mint one.
 */
import { useCallback, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Button, XStack } from '@hanzo/gui'
import { Copy, Sparkles } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { productSubpages, resolveView, slugOf } from '~/lib/products/match'
import { findEntry } from '~/lib/products/registry'
import { useViewer } from '~/lib/products/viewer'
import { useFloatingChat } from '~/components/FloatingChat'
import { useToast } from '~/components/ui/Toast'
import { compose, subjectOf } from '~/lib/brief/compose'
import { opsFor } from '~/lib/brief/ops'
import type { CatalogEntry } from '~/lib/products/registry'

/**
 * The product this address is on — index, sub-page or honest stub alike, because a
 * reader deep in `/dns/records` wants the brief just as much as one on `/dns`. The
 * home, the category and discover routers, an external launch tile and a 404 own no
 * product, so they get nothing: one strip where there is something true to say.
 */
export function productAt(pathname: string): Extract<CatalogEntry, { kind: 'module' }> | undefined {
  const view = resolveView(slugOf(pathname))
  const id =
    view.kind === 'route'
      ? view.matched.module.id
      : view.kind === 'subpage' || view.kind === 'stub'
        ? view.entry.id
        : undefined
  const entry = id ? findEntry(id) : undefined
  return entry?.kind === 'module' ? entry : undefined
}

export function Brief() {
  const { ask } = useFloatingChat()
  const toast = useToast()
  const viewer = useViewer()
  const [busy, setBusy] = useState(false)
  const entry = productAt(usePathname() ?? '')

  const run = useCallback(
    async (take: (text: string) => void) => {
      if (!entry) return
      setBusy(true)
      try {
        const ops = await opsFor(entry.id)
        // The reader's own viewer, not the default: the brief names the pages
        // THIS reader can open. Without it a customer is handed admin-stage and
        // pre-GA pages the console withholds from them everywhere else.
        const pages = productSubpages(entry, viewer).map((p) => p.label)
        take(compose(subjectOf(entry, pages, config.apiUrl, ops)))
      } finally {
        setBusy(false)
      }
    },
    [entry, viewer],
  )

  const copy = useCallback(
    () =>
      void run((text) => {
        if (typeof navigator === 'undefined' || !navigator.clipboard) {
          toast.error('Clipboard unavailable in this browser')
          return
        }
        void navigator.clipboard
          .writeText(text)
          .then(() => toast.success(`${entry?.label} brief copied`))
          // Clipboard permission is the browser's call, not ours — say what happened
          // rather than claim a copy that never landed.
          .catch(() => toast.error('Clipboard blocked by the browser'))
      }),
    [run, toast, entry],
  )

  if (!entry) return null

  return (
    // Right-aligned and label-free: two verbs that name their own action. A line of
    // prose explaining what a brief is would cost vertical rhythm on all 186 product
    // pages forever, and pressing Copy answers the question better than the prose can.
    <XStack testID="brief" items="center" justify="flex-end" gap="$2" flexWrap="wrap">
      <Button
        size="$2"
        theme="light"
        disabled={busy}
        icon={<Copy size={14} />}
        onPress={copy}
        aria-label={`Copy the ${entry.label} brief for an agent`}
      >
        Copy brief
      </Button>
      <Button
        size="$2"
        chromeless
        disabled={busy}
        icon={<Sparkles size={14} />}
        onPress={() => void run(ask)}
        aria-label={`Ask the assistant about ${entry.label}`}
      >
        Ask AI
      </Button>
    </XStack>
  )
}
