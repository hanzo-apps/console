'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'

import { ApiError, ChatApi, MessageApi, type Chat, type Message } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'

const Bubble = ({ m }: { m: Message }) => {
  const isAI = m.author === 'AI'
  return (
    <XStack justify={isAI ? 'flex-start' : 'flex-end'}>
      <Card
        p="$3"
        maxW="80%"
        bg={isAI ? '$color2' : '$color4'}
        borderWidth={1}
        borderColor="$borderColor"
        rounded="$4"
      >
        <YStack gap="$1">
          <Text fontSize="$1" color="$color11">
            {isAI ? 'AI' : m.author || 'User'}
          </Text>
          <Text fontSize="$3">{m.text ?? ''}</Text>
        </YStack>
      </Card>
    </XStack>
  )
}

/**
 * Read-only chat view: the session header + its message thread.
 *
 * Ported from ChatPage.js / ChatBox.js: loads the chat (`get-chat`) and its
 * messages (`get-messages?owner&chat`), renders each turn by author (AI vs user).
 */
export function ChatView({ name, onDone }: { name: string; onDone: () => void }) {
  const [chat, setChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    ChatApi.get('admin', name)
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
  }, [name])

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
    <>
      <PageHeader
        title={chat.displayName || chat.name}
        subtitle={`${chat.user ?? ''}${chat.store ? ` · ${chat.store}` : ''}`}
        actions={<Button onPress={onDone}>Back</Button>}
      />
      {error ? <Text color="$color12">{error}</Text> : null}
      {messages.length === 0 ? (
        <YStack p="$6" items="center" borderWidth={1} borderColor="$borderColor" rounded="$4">
          <Text color="$color11">No messages in this chat.</Text>
        </YStack>
      ) : (
        <YStack gap="$3">
          {messages.map((m) => (
            <Bubble key={`${m.owner}/${m.name}`} m={m} />
          ))}
        </YStack>
      )}
    </>
  )
}
