'use client'

/**
 * EmbeddedApp — the ONE way to surface a canonical Hanzo app (Content Studio /
 * ERP / Help Center) INSIDE the console shell. Not a link-out: the real app renders
 * in an iframe within the dashboard chrome (sidebar + top bar + breadcrumb stay),
 * so it reads as a console product, per-org, over the SAME IAM single-sign-on the
 * console already established.
 *
 * SSO, not an open frame: the embedded app runs its OWN IAM login (org == tenant,
 * enforced server-side by that app), so the frame shows only the caller's org —
 * the console never injects a credential and the iframe carries none. The user is
 * already signed in to the shared brand IAM, so the app's SSO completes silently.
 *
 * Honest by construction: an iframe can't report a cross-origin load failure to the
 * parent (same-origin policy), so this NEVER fabricates a "loaded" or "failed"
 * verdict it can't observe. It shows a real loading state until the first `load`
 * event, always offers "Open full screen" as a truthful fallback, and prints the
 * exact origin — if a brand ever blocks framing, the user still has a working path.
 *
 * DRY: CMS, ERP, and Help all render through this one component; adding another
 * embedded app is a thin module that resolves its per-brand origin + calls this.
 */
import { useCallback, useState, type ReactNode } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight, RefreshCw } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'

/**
 * The iframe permission set for an embedded first-party app: run its own scripts,
 * treat its OWN origin as same-origin (needed for its session + XHR — this does
 * NOT grant access to the cross-origin console parent, which SOP still blocks),
 * submit forms (login), and open the odd popup (OAuth/consent, downloads). This is
 * exactly what the app can do when opened directly — no more.
 */
const SANDBOX = [
  'allow-scripts',
  'allow-same-origin',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
  'allow-top-navigation-by-user-activation',
].join(' ')

export function EmbeddedApp({
  title,
  subtitle,
  src,
  openLabel = 'Open full screen',
  sourceLabel,
  note,
  actions,
}: {
  title: string
  subtitle?: string
  /** The embedded app's fully-qualified URL (per-brand origin + path). */
  src: string
  /** Label for the secondary "open in a new tab" action. */
  openLabel?: string
  /** Optional short source/repo label shown in the footer (e.g. `hanzoai/cms`). */
  sourceLabel?: string
  /** Optional one-line note under the frame (e.g. the SSO/tenancy explanation). */
  note?: ReactNode
  /** Optional extra header actions rendered before Reload / Open. */
  actions?: ReactNode
}) {
  const [loading, setLoading] = useState(true)
  // Bump to force a fresh iframe (remount) on Reload.
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => {
    setLoading(true)
    setNonce((n) => n + 1)
  }, [])
  const openTab = useCallback(() => {
    if (typeof window !== 'undefined') window.open(src, '_blank', 'noopener,noreferrer')
  }, [src])

  return (
    <YStack gap="$3" flex={1} minH={0}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <XStack gap="$2" items="center">
            {actions}
            <Button size="$2" chromeless icon={<RefreshCw size={15} />} onPress={reload}>
              Reload
            </Button>
            <Button size="$2" iconAfter={<ArrowUpRight size={15} />} onPress={openTab}>
              {openLabel}
            </Button>
          </XStack>
        }
      />

      <YStack
        borderWidth={1}
        borderColor="$borderColor"
        rounded="$4"
        overflow="hidden"
        position="relative"
        bg="$color2"
        // Fill the visible content area (viewport minus the top bar, page padding,
        // and this header). The outer ScrollView still scrolls if a viewport is short.
        style={{ height: 'calc(100vh - 184px)', minHeight: 480 }}
      >
        {loading ? (
          <YStack
            position="absolute"
            t={0}
            l={0}
            r={0}
            b={0}
            items="center"
            justify="center"
            gap="$2"
            pointerEvents="none"
            style={{ zIndex: 1 }}
          >
            <Spinner color="$color11" />
            <Text fontSize="$2" color="$color10">
              Loading {title}…
            </Text>
          </YStack>
        ) : null}
        <iframe
          key={nonce}
          src={src}
          title={title}
          onLoad={() => setLoading(false)}
          sandbox={SANDBOX}
          referrerPolicy="no-referrer-when-downgrade"
          allow="clipboard-read; clipboard-write; fullscreen"
          style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
        />
      </YStack>

      <XStack gap="$3" items="center" flexWrap="wrap">
        {note ? (
          <Text fontSize="$2" color="$color10" flex={1} minW={220}>
            {note}
          </Text>
        ) : (
          <YStack flex={1} minW={220} />
        )}
        <Text fontSize="$2" color="$color9">
          {sourceLabel ? `${sourceLabel} · ` : ''}
          {src}
        </Text>
      </XStack>
    </YStack>
  )
}
