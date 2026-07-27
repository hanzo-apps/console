'use client'

/**
 * Interactive chat — a real round-trip conversation with the model gateway.
 *
 * This is the working Chat surface (the prior module was a read-only history
 * viewer). It composes the ONE AI binding (`AiApi.ragChatStream` → the keyless
 * `/ai` proxy → streaming /v1/chat/completions) with a turn-by-turn thread: append
 * the user turn, send the full history, then STREAM the assistant reply token-by-
 * token (like the playground). Nothing is faked — every reply is a real completion,
 * and a failure renders an honest state (including the 402 "add credits" billing
 * gate), never fabricated text.
 *
 * Presentation: assistant turns read as open text with a sparkle avatar + name +
 * time (no boxed card); the user turn is a compact accent bubble; both render
 * light markdown (fenced code, inline code, bold). The empty state is a polished
 * welcome with clickable suggested prompts, and the composer is a single rounded,
 * elevated input with a code-insert and send affordance + a muted hint row.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, ScrollView, Spinner, Text, TextArea, XStack, YStack } from '@hanzo/gui'
import { Send, Sparkles, Plus, History, Braces, Brain, ChevronDown, ChevronRight } from '@hanzogui/lucide-icons-2'

import { AiApi, PlaygroundApi, type ChatMessage } from '~/lib/api'
import { DEFAULT_MODEL } from '~/lib/api/families'
import { hanzoAssistantSystemPrompt, ASSISTANT_DOCS_STORE } from '~/lib/assistant'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { config } from '~/config'
import { PageHeader } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { Markdown } from './markdown'
import { splitThinking } from './thinking'

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

/** A collapsed-by-default disclosure for a turn's reasoning trace (nothing when empty). */
function ThinkingDisclosure({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <YStack gap="$1.5">
      <XStack
        onPress={() => setOpen((o) => !o)}
        cursor="pointer"
        items="center"
        gap="$1.5"
        self="flex-start"
        px="$2"
        py="$1"
        rounded="$4"
        hoverStyle={{ bg: '$color3' }}
        aria-label={open ? 'Hide thinking' : 'Show thinking'}
      >
        <Chevron size={13} color="$color10" />
        <Brain size={13} color="$color10" />
        <Text fontSize="$1" color="$color10">
          {open ? 'Hide thinking' : 'Show thinking'}
        </Text>
      </XStack>
      {open ? (
        <YStack borderLeftWidth={2} borderColor="$borderColor" pl="$3" opacity={0.8}>
          <Markdown content={text} size="$2" />
        </YStack>
      ) : null}
    </YStack>
  )
}

function Bubble({ role, content, time, thinking }: ChatMessage & { time?: string; thinking?: string }) {
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
        {thinking ? <ThinkingDisclosure text={thinking} /> : null}
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
  const abortRef = useRef<AbortController | null>(null)

  // The ONE grounded assistant prompt (product catalog + curated overview), scoped
  // so a global admin sees admin surfaces and a customer never does. Built once per
  // admin state — the same prompt backs the floating bubble and the full Chat page.
  const showAdmin = useIsSuperAdmin()
  const system = useMemo(() => hanzoAssistantSystemPrompt({ showAdmin }), [showAdmin])

  // Default to the trial-safe Zen default once the catalog loads: prefer the
  // NON-PREMIUM `DEFAULT_MODEL` (the same default the Models page pills and the
  // Playground pick), then any Zen model, then the first — so a $5-trial user's
  // first message never 402s on a premium default.
  useEffect(() => {
    let live = true
    PlaygroundApi.listModels()
      .then((ids) => {
        if (live && ids.length)
          setModel(
            (m) =>
              m ||
              ids.find((x) => x.toLowerCase() === DEFAULT_MODEL) ||
              ids.find((x) => /zen/i.test(x)) ||
              ids[0],
          )
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

  /**
   * Stream one assistant reply for `q` over the given prior `history`. An empty
   * assistant turn is appended up front (rendered as "Thinking…" until the first
   * token), then each chunk GROWS that trailing turn — deterministic, pure state
   * updaters only (no closure flag → strict-mode safe). Grounded via the shared
   * expert prompt + docs retrieval (best-effort server-side — the gateway answers
   * plainly if the store isn't indexed). Shared by `send` (a new turn) and `retry`
   * (re-run the last turn). A failure drops the empty turn and renders an honest
   * error card, never fabricated text.
   */
  const streamReply = async (q: string, history: ChatMessage[]) => {
    setSending(true)
    setError(null)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setMessages((m) => [...m, { role: 'assistant', content: '', time: turnTime() }])
    try {
      const final = await AiApi.ragChatStream(
        { question: q, history, system, store: ASSISTANT_DOCS_STORE, model: model || undefined, temperature: 0.7 },
        (text) =>
          setMessages((m) => {
            const next = m.slice()
            next[next.length - 1] = { ...next[next.length - 1], content: text }
            return next
          }),
        ctrl.signal,
      )
      // Fill an empty completion with an honest marker (the turn stays, never blank).
      setMessages((m) => {
        const last = m[m.length - 1]
        if (!last || last.role !== 'assistant' || last.content) return m
        const next = m.slice()
        next[next.length - 1] = { ...last, content: final || '(empty response)' }
        return next
      })
    } catch (e) {
      // Drop the still-empty assistant turn; surface the error card (unless aborted).
      setMessages((m) => {
        const last = m[m.length - 1]
        return last && last.role === 'assistant' && !last.content ? m.slice(0, -1) : m
      })
      if (!ctrl.signal.aborted) setError(classifyBackend(e))
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      setSending(false)
    }
  }

  const send = async () => {
    const q = input.trim()
    if (!q || sending) return
    const history = messages.map(({ role, content }) => ({ role, content }))
    setMessages((m) => [...m, { role: 'user', content: q, time: turnTime() }])
    setInput('')
    await streamReply(q, history)
  }

  /** Re-run the last user turn (the error-card retry) — resend, don't duplicate it. */
  const retry = () => {
    if (sending) return
    const idx = messages.map((m) => m.role).lastIndexOf('user')
    if (idx < 0) return
    const q = messages[idx].content
    const history = messages.slice(0, idx).map(({ role, content }) => ({ role, content }))
    void streamReply(q, history)
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
    abortRef.current?.abort()
    setMessages([])
    setError(null)
    setInput('')
  }

  // Cancel any in-flight stream when the conversation unmounts (leak-free).
  useEffect(() => () => abortRef.current?.abort(), [])

  const empty = messages.length === 0 && !error

  return (
    // Full-page mode caps the conversation column (~820px, centered) so lines stay
    // readable on ultra-wide displays instead of running edge-to-edge; compact mode
    // (the floating bubble) owns its own width.
    <YStack
      flex={1}
      gap="$4"
      minH={compact ? 0 : 480}
      width="100%"
      maxW={compact ? undefined : 820}
      mx={compact ? undefined : 'auto'}
    >
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
              {/* A user turn renders verbatim. An assistant turn is split into its final
                  answer and any `<think>` reasoning: with no answer yet (pre-first-token
                  or still mid-reasoning) it shows "Thinking…"; otherwise the bubble shows
                  the answer with the reasoning tucked behind a disclosure — never leaked. */}
              {messages.map((m, i) => {
                if (m.role !== 'assistant') {
                  return <Bubble key={i} role={m.role} content={m.content} time={m.time} />
                }
                const { answer, thinking } = splitThinking(m.content)
                if (!answer) {
                  return (
                    <XStack key={i} gap="$3" items="center">
                      <SparkleAvatar />
                      <XStack gap="$2" items="center">
                        <Spinner color="$color11" />
                        <Text color="$color11" fontSize="$3">
                          Thinking…
                        </Text>
                      </XStack>
                    </XStack>
                  )
                }
                return <Bubble key={i} role="assistant" content={answer} thinking={thinking} time={m.time} />
              })}
              {error ? <BackendStateCard state={error} onRetry={retry} /> : null}
              {/* scroll sentinel (id, not ref — avoids tamagui element typing) */}
              <YStack id="chat-bottom" height={1} />
            </YStack>
          )}
        </ScrollView>
      </YStack>

      {/* Composer dock — sticky to the viewport bottom on phones/tablets (see
          `.hz-chat-dock`) so the input is always reachable as the conversation
          scrolls beneath; static in the capped column from lg up. The floating
          bubble (compact) fills a bounded flex container, so it stays in flow. */}
      <YStack className={compact ? undefined : 'hz-chat-dock'} bg="$background" pt="$2" gap="$2">
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
              // `onKeyDown` reaches the DOM textarea (Enter's newline default fires on
              // keydown, so only preventDefault here stops it); `onKeyPress` is swallowed
              // by the input and never fires. Enter sends; Shift+Enter is a newline; a key
              // mid-IME-composition is never a send.
              onKeyDown={(e) => {
                const ev = e as unknown as {
                  key?: string
                  shiftKey?: boolean
                  preventDefault?: () => void
                  nativeEvent?: { isComposing?: boolean }
                }
                if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent?.isComposing) {
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
              minW={44}
              minH={44}
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
    </YStack>
  )
}
