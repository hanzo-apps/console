'use client'

/**
 * Playground — try models and prompts against the LIVE gateway, with the marquee
 * being SIDE-BY-SIDE multi-model comparison.
 *
 * One tabbed surface over the OpenAI-compatible gateway (GET /v1/models +
 * POST /v1/chat/completions|embeddings|audio/speech), all through the keyless
 * `/ai` proxy console2 already uses — no key in the browser, no re-auth:
 *   - Chat / Completions  → the COMPARE board: one shared prompt fans out to N
 *     model columns that run in PARALLEL and stream independently, each showing
 *     real tokens, cost (catalog pricing) and latency (time-to-first-token +
 *     total). Single-model mode is just one column.
 *   - Embeddings          → a real single-model embeddings run (dims + usage).
 *   - Audio               → text-to-speech (real audio bytes from the gateway).
 *   - Vision              → multimodal chat with an image URL, same runner.
 * Nothing is fabricated — every output, token count and price is real, and each
 * surface renders an honest state on failure.
 */
import { useState } from 'react'
import type { ComponentType } from 'react'
import { Button, XStack, YStack } from '@hanzo/gui'
import { MessageSquare, FileText, Binary, AudioLines, ScanEye } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'
import { ComparePlayground } from './playground/ComparePlayground'
import { EmbeddingsPlayground } from './playground/EmbeddingsPlayground'
import { AudioPlayground } from './playground/AudioPlayground'
import { VisionPlayground } from './playground/VisionPlayground'

type Tab = 'chat' | 'completions' | 'embeddings' | 'audio' | 'vision'

const TABS: { id: Tab; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'completions', label: 'Completions', Icon: FileText },
  { id: 'embeddings', label: 'Embeddings', Icon: Binary },
  { id: 'audio', label: 'Audio', Icon: AudioLines },
  { id: 'vision', label: 'Vision', Icon: ScanEye },
]

function TabButton({
  active,
  label,
  Icon,
  onPress,
}: {
  active: boolean
  label: string
  Icon: ComponentType<{ size?: number }>
  onPress: () => void
}) {
  return (
    <Button
      size="$2"
      icon={<Icon size={15} />}
      bg={active ? '$color5' : 'transparent'}
      borderWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
    >
      {label}
    </Button>
  )
}

export function PlaygroundModule(_props: { params: Record<string, string> }) {
  const [tab, setTab] = useState<Tab>('chat')

  return (
    <YStack gap="$4">
      <PageHeader
        title="Playground"
        subtitle="Compare models side by side — one prompt, many models, real tokens, cost and latency."
      />

      <XStack gap="$1.5" flexWrap="wrap">
        {TABS.map((t) => (
          <TabButton key={t.id} active={tab === t.id} label={t.label} Icon={t.Icon} onPress={() => setTab(t.id)} />
        ))}
      </XStack>

      {tab === 'chat' ? (
        <ComparePlayground mode="chat" />
      ) : tab === 'completions' ? (
        <ComparePlayground mode="completions" />
      ) : tab === 'embeddings' ? (
        <EmbeddingsPlayground />
      ) : tab === 'audio' ? (
        <AudioPlayground />
      ) : (
        <VisionPlayground />
      )}
    </YStack>
  )
}
