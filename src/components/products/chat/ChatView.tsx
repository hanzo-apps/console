'use client'

import { useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Sparkles } from '@hanzogui/lucide-icons-2'

import { ApiError, ChatApi, MessageApi, type Chat, type Message } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { PageHeader } from '@hanzo/ui/product'
import { Markdown } from './markdown'

/** The sparkle medallion marking an AI turn (matches the live conversation). */
function SparkleAvatar() {
  return (
    <XStack width={28} height={28} rounded="$10" items="center" justify="center" bg="$color5">
      <Sparkles size={15} color="$color12" />
    </XStack>
  )
}

const Bubble = ({ m }: { m: Message }) => {
  const isAI = m.author === 'AI'
  const text = m.text ?? ''
  if (!isAI) {
    // Right-aligned accent bubble.
    return (
      <XStack justify="flex-end">
        <YStack maxW="80%" bg="$color5" px="$3.5" py="$2.5" rounded="$6" borderTopRightRadius="$2">
          <Markdown content={text} />
        </YStack>
      </XStack>
    )
  }
  // AI — open text with sparkle avatar + name.
  return (
    <XStack gap="$3" items="flex-start">
      <YStack pt="$1">
        <SparkleAvatar />
      </YStack>
      <YStack flex={1} gap="$1.5" minW={0}>
        <Text fontSize="$2" fontWeight="700" color="$color12">
          {m.author || 'AI'}
        </Text>
        <Markdown content={text} />
      </YStack>
    </XStack>
  )
}

/**
 * Read-only chat view: the session header + its message thread.
 *
 * Ported from ChatPage.js / ChatBox.js: loads the chat (`get-chat`) and its
 * messages (`get-messages?owner&chat`), renders each turn by author (AI vs user).
 */
export function ChatView({ owner, name, onDone }: { owner?: string; name: string; onDone: () => void }) {
  const [chat, setChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    // Use the chat's REAL owner (carried in the route); a legacy single-segment link
    // with no owner falls back to the active org — never a hardcoded `admin`, which
    // 404'd every non-admin org's saved chats.
    ChatApi.get(owner || currentOrg(), name)
      .then(async (c) => {
        if (!live) return
        setChat(c)
        const msgs = await MessageApi.listForChat(c.owner, c.name)
        if (live) {
          setMessages(msgs ?? [])
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : 'Failed to load chat')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [owner, name])

  if (loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  if (error && !chat) {
    return (
      <YStack gap="$3">
        <Text color="$color12">{error}</Text>
        <Button self="flex-start" onPress={onDone}>
          Back
        </Button>
      </YStack>
    )
  }
  if (!chat) return null

  return (
    <YStack gap="$4">
      <PageHeader
        title={chat.displayName || chat.name}
        subtitle={`${chat.user ?? ''}${chat.store ? ` · ${chat.store}` : ''}`}
        actions={<Button onPress={onDone}>Back</Button>}
      />
      {error ? <Text color="$color12">{error}</Text> : null}
      {messages.length === 0 ? (
        <YStack p="$6" items="center" gap="$2" borderWidth={1} borderColor="$borderColor" rounded="$4">
          <Sparkles size={22} opacity={0.5} />
          <Text color="$color11">No messages in this chat.</Text>
        </YStack>
      ) : (
        <YStack gap="$5">
          {messages.map((m) => (
            <Bubble key={`${m.owner}/${m.name}`} m={m} />
          ))}
        </YStack>
      )}
    </YStack>
  )
}
