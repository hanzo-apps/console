'use client'

/**
 * The ONE "no such page" surface.
 *
 * The console had none, and the silence cost more than a missing screen: every
 * unknown address rendered the home board with the unknown words in the
 * breadcrumb, so a broken link and a typo'd URL looked identical — and both
 * looked like a working page. That is how a nav item that ejected the console
 * entirely, bounced through a sibling app's `/login`, and came back to the
 * dashboard read as "Tracker opens the dashboard" instead of "Tracker left".
 *
 * So it names the address it could not resolve. The address is the evidence: a
 * word you did not type is a link that is wrong, not a key you mistyped.
 *
 * Rendered by `ProductRoute` (the ONE product-route renderer, so it holds for a
 * real Next server AND for the static embed, where the cloud binary serves the
 * SPA's index.html for every path and the resolution happens client-side) and by
 * `app/not-found.tsx` (Next's own boundary for a path no route file claims).
 */
import { useRouter } from 'next/navigation'
import { FileQuestion } from '@hanzogui/lucide-icons-2'

import { EmptyState, FadeIn, PageHeader } from '@hanzo/ui/product'

export function NotFound({ slug = [] }: { slug?: string[] }) {
  const router = useRouter()
  // The address, printed the way it was asked for.
  const address = `/${slug.map(decodeURIComponent).join('/')}`

  return (
    <>
      <PageHeader title="No such page" subtitle={`Nothing is served at ${address}.`} />
      <FadeIn style={{ width: '100%' }}>
        <EmptyState
          icon={FileQuestion}
          title={address}
          description="This console has no page at that address. If you followed a link inside the console, the link is wrong — that is worth reporting; if you typed or bookmarked it, check the spelling."
          bullets={[
            'Nothing was loaded and nothing was invented — an address that resolves to no product says so.',
            'Every product is reachable from the sidebar, or from search (⌘K).',
          ]}
          primary={{ label: 'Go home', onPress: () => router.push('/') }}
          secondary={{ label: 'Browse all products', onPress: () => router.push('/discover') }}
        />
      </FadeIn>
    </>
  )
}
