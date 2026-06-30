'use client'

/**
 * Interactive chat — a real round-trip conversation with the model gateway.
 *
 * This is the working Chat surface (the prior module was a read-only history
 * viewer). It composes the ONE AI binding (`AiApi.chat` → the keyless `/ai`
 * proxy → /v1/chat/completions) with a turn-by-turn thread: append the user
 * turn, send the full history, append the assistant reply. Nothing is faked —
 * every reply is a real completion, and a failure renders an honest state
 * (including the 402 "add credits" billing gate), never fabricated text.
 */
import { useEffect, useState } from 'react'
import { Button, Card, ScrollView, Spinner, Text, TextArea, XStack, YStack } from '@hanzo/gui'
import { Send, Sparkles, Plus, History } from '@hanzogui/lucide-icons-2'

import { AiApi, PlaygroundApi, type ChatMessage } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

function Bubble({ role, content }: ChatMessage) {
  const isUser = role === 'user'
  return (
    <XStack justify={isUser ? 'flex-end' : 'flex-start'}>
      <Card
        p="$3"
        maxW="82%"
        bg={isUser ? '$color5' : '$color2'}
        borderWidth={1}
        borderColor="$borderColor"
        rounded="$4"
      >
        <YStack gap="$1">
          <Text fontSize="$1" color="$color10" fontWeight="700">
            {isUser ? 'You' : 'Assistant'}
          </Text>
          {content.split('\n').map((line, i) => (
            <Text key={i} fontSize="$3" color="$color12">
              {line === '' ? ' ' : line}
            </Text>
          ))}
        </YStack>
      </Card>
    </XStack>
  )
}

export function ChatConversation({
  onShowHistory,
  compact = false,
}: {
  onShowHistory: () => void
  /** Embedded mode (the floating bubble): drop the page header + fixed min-height
   * so the conversation fills its container instead of a full page. */
  compact?: boolean
}) {
  const [model, setModel] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)

  // Default to a Zen model once the catalog loads (Hanzo-first), else the first.
  useEffect(() => {
    let live = true
    PlaygroundApi.listModels()
      .then((ids) => {
        if (live && ids.length) setModel((m) => m || (ids.find((x) => /zen/i.test(x)) ?? ids[0]))
      })
      .catch(() => {
        /* model stays auto-resolved server-side */
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.getElementById('chat-bottom')?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages, sending])

  const send = async () => {
    const q = input.trim()
    if (!q || sending) return
    const history = messages
    setMessages((m) => [...m, { role: 'user', content: q }])
    setInput('')
    setSending(true)
    setError(null)
    try {
      const reply = await AiApi.chat({
        question: q,
        history,
        model: model || undefined,
        temperature: 0.7,
      })
      setMessages((m) => [...m, { role: 'assistant', content: reply || '(empty response)' }])
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <YStack flex={1} gap="$3" minH={compact ? 0 : 480}>
      {compact ? (
        <XStack items="center" justify="flex-end" gap="$2">
          <Button size="$2" icon={<History size={15} />} onPress={onShowHistory}>
            Open full chat
          </Button>
          <Button
            size="$2"
            icon={<Plus size={15} />}
            disabled={messages.length === 0 && !error}
            onPress={() => {
              setMessages([])
              setError(null)
            }}
          >
            New
          </Button>
        </XStack>
      ) : (
        <PageHeader
          title="Chat"
          subtitle={`Talk to ${model || 'Zen'} and other models — real completions through the gateway.`}
          actions={
            <XStack gap="$2">
              <Button size="$2" icon={<History size={15} />} onPress={onShowHistory}>
                History
              </Button>
              <Button
                size="$2"
                icon={<Plus size={15} />}
                disabled={messages.length === 0 && !error}
                onPress={() => {
                  setMessages([])
                  setError(null)
                }}
              >
                New chat
              </Button>
            </XStack>
          }
        />
      )}

      <Card flex={1} borderWidth={1} borderColor="$borderColor" p="$3" gap="$3" minH={compact ? 0 : 320}>
        <ScrollView flex={1}>
          {messages.length === 0 && !error ? (
            <YStack flex={1} items="center" justify="center" p="$6" gap="$2">
              <Sparkles size={26} opacity={0.6} />
              <Text fontSize="$5" fontWeight="700" color="$color12">
                Start a conversation
              </Text>
              <Text fontSize="$3" color="$color10" maxW={420} style={{ textAlign: 'center' }}>
                Ask anything. Responses come from the live model gateway, billed to your organization.
              </Text>
            </YStack>
          ) : (
            <YStack gap="$3">
              {messages.map((m, i) => (
                <Bubble key={i} role={m.role} content={m.content} />
              ))}
              {sending ? (
                <XStack gap="$2" items="center" p="$2">
                  <Spinner color="$color11" />
                  <Text color="$color11" fontSize="$3">
                    Thinking…
                  </Text>
                </XStack>
              ) : null}
              {error ? <BackendStateCard state={error} onRetry={() => void send()} /> : null}
              {/* scroll sentinel (id, not ref — avoids tamagui element typing) */}
              <YStack id="chat-bottom" height={1} />
            </YStack>
          )}
        </ScrollView>
      </Card>

      <Card borderWidth={1} borderColor="$borderColor" p="$2.5">
        <XStack gap="$2" items="flex-end">
          <YStack flex={1}>
            <TextArea
              value={input}
              onChangeText={setInput}
              placeholder="Message the assistant…  (Enter to send, Shift+Enter for a new line)"
              numberOfLines={2}
              disabled={sending}
              onKeyPress={(e) => {
                const ev = e as unknown as {
                  key?: string
                  shiftKey?: boolean
                  preventDefault?: () => void
                  nativeEvent?: { key?: string; shiftKey?: boolean }
                }
                const key = ev.key ?? ev.nativeEvent?.key
                const shift = ev.shiftKey ?? ev.nativeEvent?.shiftKey
                if (key === 'Enter' && !shift) {
                  ev.preventDefault?.()
                  void send()
                }
              }}
            />
          </YStack>
          <Button
            bg="$color5"
            icon={<Send size={16} />}
            disabled={sending || !input.trim()}
            onPress={() => void send()}
          >
            Send
          </Button>
        </XStack>
      </Card>
    </YStack>
  )
}
