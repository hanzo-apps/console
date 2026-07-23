'use client'

/**
 * Agentic handoffs for the Code hub — the "make it usable by an agent day one" row,
 * shared DRY at BOTH the repo level (the browser header) and the file level (the blob
 * pane). Three affordances, each reusing an EXISTING console primitive — nothing new:
 *
 *  - **Ask AI** — the console's built-in grounded assistant (`useFloatingChat().ask`),
 *    seeded with the repo/file as context (composed by `hub-logic`). Opens the assistant
 *    with the prompt pre-filled; the user reviews and sends (never an auto-send).
 *  - **Edit** — the cross-surface deep link into the hanzo.app builder
 *    (`crossSurfaceLinks().editInApp` → `hanzo.app/dev?project=<repo>`, the ONE shared
 *    `?project=` convention), opened in a new tab.
 *  - **Chat** — the project-scoped hanzo.chat deep link (`crossSurfaceLinks().chatAbout`).
 *
 * The project key is the repo name run through the shared `slugifyProjectName` (the SAME
 * slug the deploy site + IAM project use), so a repo, its site, and its chat all resolve
 * to one key. Injection-safe by construction (the cross-surface helpers URL-encode).
 */
import { Button, XStack } from '@hanzo/gui'
import { MessageSquare, Pencil, Sparkles } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { crossSurfaceLinks, slugifyProjectName } from '~/lib/products/cross-surface'
import { useFloatingChat } from '~/components/FloatingChat'

const openExternal = (url: string) => {
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
}

export function AgentActions({
  repo,
  seedPrompt,
  size = '$2',
  askOnly = false,
}: {
  /** The repo name — slugified to the ONE shared project key for the deep links. */
  repo: string
  /** The composed assistant seed (repo- or file-scoped, from `hub-logic`). */
  seedPrompt: string
  size?: '$2' | '$3'
  /** Render ONLY the "Ask AI" button (file level — Edit/Chat are repo-level, shown once
   *  in the repo header). Default renders all three affordances. */
  askOnly?: boolean
}) {
  const { ask } = useFloatingChat()
  const links = crossSurfaceLinks(slugifyProjectName(repo), {
    appUrl: config.appUrl,
    chatUrl: config.chatUrl,
  })
  return (
    <XStack items="center" gap="$1.5" flexWrap="wrap">
      <Button
        size={size}
        theme="light"
        icon={<Sparkles size={14} />}
        onPress={() => ask(seedPrompt)}
        aria-label="Ask the AI assistant about this code"
      >
        Ask AI
      </Button>
      {askOnly ? null : (
        <>
          <Button
            size={size}
            icon={<Pencil size={14} />}
            onPress={() => openExternal(links.editInApp)}
            aria-label="Edit in the hanzo.app builder"
          >
            Edit
          </Button>
          <Button
            size={size}
            chromeless
            icon={<MessageSquare size={14} />}
            onPress={() => openExternal(links.chatAbout)}
            aria-label="Discuss this project in Hanzo Chat"
          >
            Chat
          </Button>
        </>
      )}
    </XStack>
  )
}
