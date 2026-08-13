'use client'

/**
 * Playground — test models and iterate prompts against the LIVE gateway.
 *
 * One tabbed surface over the OpenAI-compatible gateway, all through the keyless
 * `/ai` proxy console2 already uses (no key in the browser, no re-auth):
 *   - Chat / Completions → the single-model composer (`ChatPlayground`): a model
 *     chip with a real context badge, an editable system prompt + message turns,
 *     and a Response + Model-settings rail showing the real completion, token
 *     usage and cost. Examples are labelled starters; History is real prior runs.
 *   - Embeddings → a real single-model embeddings run (dims + usage).
 *   - Audio → text-to-speech (real audio bytes from the gateway).
 *   - Vision → multimodal chat with an image URL, same runner.
 * Nothing is fabricated — every output, token count and price is real, and each
 * surface renders an honest state on failure.
 */
import { useState, useRef, useEffect } from 'react'
import type { ComponentType } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { MessageSquare, FileText, Binary, AudioLines, ScanEye, Image as ImageIcon, Clapperboard } from '@hanzogui/lucide-icons-2'

import { ChatPlayground } from './playground/ChatPlayground'
import { EmbeddingsPlayground } from './playground/EmbeddingsPlayground'
import { AudioPlayground } from './playground/AudioPlayground'
import { ImagePlayground } from './playground/ImagePlayground'
import { VideoPlayground } from './playground/VideoPlayground'
import { VisionPlayground } from './playground/VisionPlayground'
import { PageHeader } from '@hanzo/ui/product'

type Tab = 'chat' | 'completions' | 'embeddings' | 'image' | 'video' | 'audio' | 'vision'

const TABS: { id: Tab; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'completions', label: 'Completions', Icon: FileText },
  { id: 'embeddings', label: 'Embeddings', Icon: Binary },
  { id: 'image', label: 'Image', Icon: ImageIcon },
  { id: 'video', label: 'Video', Icon: Clapperboard },
  { id: 'audio', label: 'Audio', Icon: AudioLines },
  { id: 'vision', label: 'Vision', Icon: ScanEye },
]

/** One copy of the seven modes. Rendered twice inside the track, so the crawl
 *  can translate by exactly one copy's width and land seamlessly. The second is
 *  a visual duplicate: `aria-hidden` and out of the tab order, so a screen
 *  reader hears seven modes and not fourteen — but it still switches on press,
 *  because a thumb aiming at what it can see should not be told it is a copy. */
function ModeRow({
  tab,
  onChange,
  dup = false,
}: {
  tab: Tab
  onChange: (t: Tab) => void
  dup?: boolean
}) {
  return (
    <XStack className="pg-modes-group" gap="$1" {...(dup ? { 'aria-hidden': true } : {})}>
      {TABS.map(({ id, label, Icon }) => {
        const active = tab === id
        return (
          <Button
            key={(dup ? 'b-' : 'a-') + id}
            size="$2"
            chromeless={!active}
            bg={active ? '$color1' : 'transparent'}
            rounded="$10"
            px="$3"
            icon={<Icon size={15} />}
            onPress={() => onChange(id)}
          >
            <Text fontSize="$2" color={active ? '$color12' : '$color10'} fontWeight="600" whiteSpace="nowrap">
              {label}
            </Text>
          </Button>
        )
      })}
    </XStack>
  )
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const crawl = useRef<HTMLDivElement>(null)
  const release = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* Freeze on touch. The element under the finger at pointerdown is the one the
     click resolves to, so pausing here is what makes a moving mode hittable at
     all; holding it a few seconds after gives a missed aim somewhere to land
     instead of chasing the row. Hover cannot do this job — a touch has no
     hover. */
  const hold = () => {
    const el = crawl.current
    if (!el) return
    el.classList.add('pg-hold')
    if (release.current) clearTimeout(release.current)
    release.current = setTimeout(() => el.classList.remove('pg-hold'), 4000)
  }
  useEffect(() => () => { if (release.current) clearTimeout(release.current) }, [])

  return (
    /* A plain div, not a YStack, and deliberately: this element needs a real DOM
       node to put `pg-hold` on, and a gui primitive's ref is a GuiElement, not
       an HTMLElement. Reaching for a cast here would have bought a ref that
       type-checks and has no classList at runtime. */
    <XStack className="pg-modes-shell" bg="$color3" rounded="$10" p="$1" data-tour="pg-modes">
      <div ref={crawl} className="pg-modes-crawl" onPointerDown={hold}>
        <XStack className="pg-modes-track">
          <ModeRow tab={tab} onChange={onChange} />
          <ModeRow tab={tab} onChange={onChange} dup />
        </XStack>
      </div>
    </XStack>
  )
}

export function PlaygroundModule(_props: { params: Record<string, string> }) {
  const [tab, setTab] = useState<Tab>('chat')

  return (
    <YStack gap="$4">
      <PageHeader
        title="Playground"
        subtitle="Test models, iterate prompts, and build with real-time responses."
      />

      <TabBar tab={tab} onChange={setTab} />

      {tab === 'chat' || tab === 'completions' ? (
        // Same element + key across chat↔completions so the composer state persists.
        <ChatPlayground key="chat" mode={tab} />
      ) : tab === 'embeddings' ? (
        <EmbeddingsPlayground />
      ) : tab === 'image' ? (
        <ImagePlayground />
      ) : tab === 'video' ? (
        <VideoPlayground />
      ) : tab === 'audio' ? (
        <AudioPlayground />
      ) : (
        <VisionPlayground />
      )}
    </YStack>
  )
}
