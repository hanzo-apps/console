'use client'

/**
 * Studio — the FULL Hanzo Studio app (home gallery, node editor, queue, GPUs,
 * copilot) embedded in the console shell, so every Studio capability is usable
 * from cloud.hanzo.ai / console.hanzo.ai without leaving the console.
 *
 * The embed is a first-party SAME-SITE iframe (studio.<brand> shares the
 * console host's eTLD+1), so Studio's own IAM session cookies flow inside the
 * frame and its OIDC leg completes silently for a signed-in console user (a
 * live hanzo.id session renders nothing — the authorize endpoint just 302s
 * back to Studio with a code). When the frame CANNOT establish a session (an
 * expired IAM cookie — the login page refuses framing by design), the header's
 * "Open full screen" is the honest fallback; no embedded state is fabricated.
 *
 * WHITE-LABEL: a brand cloud without its own Studio instance gets an honest
 * not-provisioned card — NEVER another brand's instance. `studioUrl(host)` in
 * config is the ONE gate.
 */
import { useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink, Sparkles } from '@hanzogui/lucide-icons-2'

import { studioUrl } from '~/config'
import { EmptyState } from '@hanzo/ui/product'

type StudioView = 'home' | 'editor'

const VIEWS: { id: StudioView; label: string; path: string }[] = [
  { id: 'home', label: 'Studio', path: '/studio' },
  { id: 'editor', label: 'Editor', path: '/?advanced=1' },
]

export function StudioModule() {
  const base = studioUrl(typeof window !== 'undefined' ? window.location.host : undefined)
  const [view, setView] = useState<StudioView>('home')
  const [loaded, setLoaded] = useState(false)

  if (!base) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Studio isn’t provisioned for this cloud yet"
        description="Studio is where you generate, edit, and compose media — a node editor, a render queue, and GPUs behind it. Ask your cloud operator to provision a Studio instance for this brand."
      />
    )
  }

  const active = VIEWS.find((v) => v.id === view) ?? VIEWS[0]
  const src = `${base}${active.path}`

  return (
    <YStack gap="$2.5" flex={1} minH={0}>
      <XStack items="center" gap="$2" flexWrap="wrap">
        {VIEWS.map((v) => (
          <Button
            key={v.id}
            size="$2"
            bg={view === v.id ? '$color4' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => {
              setLoaded(false)
              setView(v.id)
            }}
            aria-label={v.label}
          >
            {v.label}
          </Button>
        ))}
        <XStack flex={1} />
        {!loaded ? (
          <Text fontSize="$1" color="$color10">
            Loading Studio…
          </Text>
        ) : null}
        {/* The honest escape hatch — the same app, own tab (needed when the
            frame can't establish a session; the IAM login refuses framing). */}
        <Button
          size="$2"
          chromeless
          icon={<ExternalLink size={14} />}
          onPress={() => {
            if (typeof window !== 'undefined') window.open(src, '_blank', 'noopener')
          }}
          aria-label="Open Studio full screen"
        >
          Full screen
        </Button>
      </XStack>

      <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden" style={{ height: 'calc(100vh - 232px)', minHeight: 560 }}>
        <iframe
          key={view}
          src={src}
          title="Hanzo Studio"
          onLoad={() => setLoaded(true)}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </YStack>
    </YStack>
  )
}
