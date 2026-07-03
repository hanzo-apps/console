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
 *
 * Presentation: assistant turns read as open text with a sparkle avatar + name +
 * time (no boxed card); the user turn is a compact accent bubble; both render
 * light markdown (fenced code, inline code, bold). The empty state is a polished
 * welcome with clickable suggested prompts, and the composer is a single rounded,
 * elevated input with a code-insert and send affordance + a muted hint row.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, ScrollView, Spinner, Text, TextArea, XStack, YStack } from '@hanzo/gui'
import { Send, Sparkles, Plus, History, Braces } from '@hanzogui/lucide-icons-2'

import { AiApi, PlaygroundApi, type ChatMessage } from '~/lib/api'
import { hanzoAssistantSystemPrompt, ASSISTANT_DOCS_STORE } from '~/lib/assistant'
import { useIsGlobalAdmin } from '~/lib/auth/admin'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { Markdown } from './markdown'

/** The sparkle medallion that marks an assistant turn (and the welcome screen). */
function SparkleAvatar({ size = 28 }: { size?: number }) {
  return (
    <XStack
      width={size}
      height={size}
      rounded="$10"
      items="center"
      justify="center"
      bg="$color5"
    >
      <Sparkles size={Math.round(size * 0.52)} color="$color12" />
    </XStack>
  )
}

/** A short relative timestamp for a turn ("now"); turns are appended live. */
const turnTime = () =>
  new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function Bubble({ role, content, time }: ChatMessage & { time?: string }) {
  const isUser = role === 'user'
  if (isUser) {
    // Right-aligned accent bubble — compact, rounded, comfortable padding.
    return (
      <XStack justify="flex-end">
        <YStack
          maxW="80%"
          bg="$color5"
          px="$3.5"
          py="$2.5"
          rounded="$6"
          borderTopRightRadius="$2"
        >
          <Markdown content={content} />
        </YStack>
      </XStack>
    )
  }
  // Assistant — open text with avatar + name + time, no boxed card.
  return (
    <XStack gap="$3" items="flex-start">
      <YStack pt="$1">
        <SparkleAvatar />
      </YStack>
      <YStack flex={1} gap="$1.5" minW={0}>
        <XStack items="center" gap="$2">
          <Text fontSize="$2" fontWeight="700" color="$color12">
            Assistant
          </Text>
          {time ? (
            <Text fontSize="$1" color="$color10">
              {time}
            </Text>
          ) : null}
        </XStack>
        <Markdown content={content} />
      </YStack>
    </XStack>
  )
}

/** A clickable suggested-prompt chip — fills the composer (no send). */
function PromptChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <XStack
      onPress={onPress}
      cursor="pointer"
      items="center"
      gap="$2"
      px="$3"
      py="$2.5"
      rounded="$6"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color2"
      hoverStyle={{ bg: '$color3', borderColor: '$color8' }}
      pressStyle={{ bg: '$color4' }}
      maxW="100%"
    >
      <Sparkles size={13} color="$color10" />
      <Text fontSize="$3" color="$color12">
        {label}
      </Text>
    </XStack>
  )
}

// Seeded to the assistant's real domain — each is answerable from the grounded
// Hanzo knowledge (the product catalog + docs), so the first tap shows real expertise.
const SUGGESTED_PROMPTS = [
  'How do I launch a GPU?',
  'What is Hanzo Base, and how is it different from Vector?',
  'How does pricing work?',
  'What AI models are available?',
]

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
  const [messages, setMessages] = useState<(ChatMessage & { time?: string })[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)
  const inputRef = useRef<{ focus?: () => void } | null>(null)

  // The ONE grounded assistant prompt (product catalog + curated overview), scoped
  // so a global admin sees admin surfaces and a customer never does. Built once per
  // admin state — the same prompt backs the floating bubble and the full Chat page.
  const showAdmin = useIsGlobalAdmin()
  const system = useMemo(() => hanzoAssistantSystemPrompt({ showAdmin }), [showAdmin])

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
    const history = messages.map(({ role, content }) => ({ role, content }))
    setMessages((m) => [...m, { role: 'user', content: q, time: turnTime() }])
    setInput('')
    setSending(true)
    setError(null)
    try {
      // Grounded: the shared expert system prompt + docs retrieval. Retrieval is
      // best-effort server-side — if the docs store isn't indexed for this org the
      // gateway just answers plainly, so the assistant is expert either way.
      const reply = await AiApi.ragChat({
        question: q,
        history,
        system,
        store: ASSISTANT_DOCS_STORE,
        model: model || undefined,
        temperature: 0.7,
      })
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: reply || '(empty response)', time: turnTime() },
      ])
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setSending(false)
    }
  }

  /** Drop a code-fence skeleton into the composer and focus it (presentation aid). */
  const insertCodeFence = () => {
    setInput((v) => (v.endsWith('\n') || v === '' ? v : v + '\n') + '```\n\n```')
    inputRef.current?.focus?.()
  }

  /** Put a suggested prompt into the composer (user reviews, then sends). */
  const useSuggestion = (s: string) => {
    setInput(s)
    inputRef.current?.focus?.()
  }

  const newChat = () => {
    setMessages([])
    setError(null)
    setInput('')
  }

  const empty = messages.length === 0 && !error

  return (
    <YStack flex={1} gap="$4" minH={compact ? 0 : 480}>
      {compact ? (
        <XStack items="center" justify="flex-end" gap="$2">
          <Button size="$2" icon={<History size={15} />} onPress={onShowHistory}>
            Open full chat
          </Button>
          <Button
            size="$2"
            icon={<Plus size={15} />}
            disabled={messages.length === 0 && !error}
            onPress={newChat}
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
                onPress={newChat}
              >
                New chat
              </Button>
            </XStack>
          }
        />
      )}

      {/* Conversation surface — open canvas, not a heavy bordered card. */}
      <YStack flex={1} minH={compact ? 0 : 320}>
        <ScrollView flex={1}>
          {empty ? (
            <YStack items="center" px="$4" pt={compact ? '$6' : '$9'} pb="$6" gap="$5">
              <YStack items="center" gap="$3" maxW={460}>
                <SparkleAvatar size={56} />
                <Text fontSize={compact ? '$6' : '$8'} fontWeight="800" color="$color12" text="center">
                  How can I help?
                </Text>
                <Text fontSize="$3" color="$color11" text="center" lineHeight={22}>
                  Ask about {config.brandName} — models, GPUs, data, deploys, billing — or anything
                  else. Answers come from the live {model || 'Zen'} gateway, billed to your
                  organization.
                </Text>
              </YStack>
              <YStack gap="$2.5" items="center" self="stretch" maxW={620} mx="auto" width="100%">
                {SUGGESTED_PROMPTS.map((s) => (
                  <PromptChip key={s} label={s} onPress={() => useSuggestion(s)} />
                ))}
              </YStack>
            </YStack>
          ) : (
            <YStack gap="$5" py="$2">
              {messages.map((m, i) => (
                <Bubble key={i} role={m.role} content={m.content} time={m.time} />
              ))}
              {sending ? (
                <XStack gap="$3" items="center">
                  <SparkleAvatar />
                  <XStack gap="$2" items="center">
                    <Spinner color="$color11" />
                    <Text color="$color11" fontSize="$3">
                      Thinking…
                    </Text>
                  </XStack>
                </XStack>
              ) : null}
              {error ? <BackendStateCard state={error} onRetry={() => void send()} /> : null}
              {/* scroll sentinel (id, not ref — avoids tamagui element typing) */}
              <YStack id="chat-bottom" height={1} />
            </YStack>
          )}
        </ScrollView>
      </YStack>

      {/* Composer — one rounded, elevated input with code-insert + send. */}
      <YStack
        bg="$color2"
        borderWidth={1}
        borderColor="$borderColor"
        rounded="$7"
        px="$3"
        py="$2.5"
        gap="$2"
        focusStyle={{ borderColor: '$color8' }}
        shadowColor="rgba(0,0,0,0.18)"
        shadowRadius={12}
        shadowOffset={{ width: 0, height: 2 }}
      >
        <XStack gap="$2" items="flex-end">
          <YStack flex={1}>
            <TextArea
              ref={inputRef as never}
              value={input}
              onChangeText={setInput}
              placeholder={`Message ${model || 'the assistant'}…`}
              numberOfLines={compact ? 2 : 3}
              disabled={sending}
              borderWidth={0}
              bg="transparent"
              px="$1"
              py="$1"
              focusStyle={{ borderWidth: 0, outlineWidth: 0 }}
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
          <XStack gap="$1.5" items="center" pb="$1">
            <Button
              size="$2"
              circular
              chromeless
              icon={<Braces size={16} />}
              disabled={sending}
              onPress={insertCodeFence}
              hoverStyle={{ bg: '$color4' }}
              aria-label="Insert code block"
            />
            <Button
              size="$3"
              circular
              bg="$color5"
              icon={<Send size={16} />}
              disabled={sending || !input.trim()}
              onPress={() => void send()}
              hoverStyle={{ bg: '$color6' }}
              pressStyle={{ bg: '$color7' }}
              aria-label="Send message"
            />
          </XStack>
        </XStack>
      </YStack>
      <XStack justify="center" px="$2">
        <Text fontSize="$1" color="$color10" text="center">
          Enter to send · Shift+Enter for a new line
        </Text>
      </XStack>
    </YStack>
  )
}
