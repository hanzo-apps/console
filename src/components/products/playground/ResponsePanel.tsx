'use client'

/**
 * ResponsePanel — the right rail's Response/Logs view.
 *
 * Response: the streamed completion (real tokens as they arrive), an honest
 * backend-state card on failure, and a USAGE box (real prompt/completion tokens)
 * + COST box (those tokens × the model's real $/Mtok) — "—" when the gateway
 * doesn't return counts, never a fabricated number. Copy + thumbs are local
 * affordances. Logs: the REAL request that was sent plus the run's measured
 * timing/finish-reason, so there is a truthful record of every call.
 */
import { useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Copy, Check, ThumbsUp, ThumbsDown } from '@hanzogui/lucide-icons-2'

import { BackendStateCard } from '~/components/ui/BackendState'
import { costOf, formatLatency, formatTokens, formatUsd, tokensPerSecond } from './cost'
import type { ChatRun } from './useChatRun'
import type { ModelPricing } from '~/lib/api'

type Tab = 'response' | 'logs'

function Lines({ text }: { text: string }) {
  return (
    <YStack>
      {text.split('\n').map((line, i) => (
        <Text key={i} fontSize="$3" color="$color12" style={{ whiteSpace: 'pre-wrap' }}>
          {line === '' ? ' ' : line}
        </Text>
      ))}
    </YStack>
  )
}

function CopyButton({ text, size = 14 }: { text: string; size?: number }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        },
        () => {},
      )
    }
  }
  return (
    <Button size="$1" chromeless icon={done ? <Check size={size} color="$green10" /> : <Copy size={size} />} onPress={copy} />
  )
}

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <YStack flex={1} minW={120} gap="$1" p="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color2">
      <Text fontSize="$1" color="$color10" letterSpacing={0.5}>
        {label}
      </Text>
      <Text fontSize="$5" fontWeight="800" color="$color12">
        {value}
      </Text>
      {sub ? (
        <Text fontSize="$1" color="$color10">
          {sub}
        </Text>
      ) : null}
    </YStack>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <XStack justify="space-between" gap="$3" py="$1">
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

export function ResponsePanel({
  run,
  pricing,
  model,
  requestJson,
}: {
  run: ChatRun
  pricing: ModelPricing | null
  model: string
  requestJson: string
}) {
  const [tab, setTab] = useState<Tab>('response')
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const cost = costOf(run.usage, pricing)
  const tps = tokensPerSecond(run.usage, run.totalMs)

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color1">
      {/* Tabs + per-response actions */}
      <XStack items="center" justify="space-between" gap="$2">
        <XStack gap="$1" bg="$color3" rounded="$10" p="$1">
          {(['response', 'logs'] as Tab[]).map((t) => (
            <Button
              key={t}
              size="$2"
              chromeless={tab !== t}
              bg={tab === t ? '$color1' : 'transparent'}
              rounded="$10"
              px="$3"
              onPress={() => setTab(t)}
            >
              <Text fontSize="$2" color={tab === t ? '$color12' : '$color10'} fontWeight="600">
                {t === 'response' ? 'Response' : 'Logs'}
              </Text>
            </Button>
          ))}
        </XStack>
        {run.content ? (
          <XStack gap="$0.5" items="center">
            <CopyButton text={run.content} />
            <Button
              size="$1"
              chromeless
              icon={<ThumbsUp size={14} color={feedback === 'up' ? '$green10' : undefined} />}
              onPress={() => setFeedback((f) => (f === 'up' ? null : 'up'))}
            />
            <Button
              size="$1"
              chromeless
              icon={<ThumbsDown size={14} color={feedback === 'down' ? '$red10' : undefined} />}
              onPress={() => setFeedback((f) => (f === 'down' ? null : 'down'))}
            />
          </XStack>
        ) : null}
      </XStack>

      {tab === 'response' ? (
        <YStack gap="$3">
          <YStack minH={260} gap="$2">
            {run.error ? (
              <BackendStateCard state={run.error} />
            ) : run.content ? (
              <YStack gap="$2">
                {run.phase === 'stopped' ? (
                  <Text fontSize="$1" self="flex-start" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
                    Stopped
                  </Text>
                ) : null}
                <Lines text={run.content} />
              </YStack>
            ) : run.phase === 'streaming' ? (
              <XStack gap="$2" items="center">
                <Spinner color="$color11" />
                <Text color="$color11" fontSize="$3">
                  Waiting for first token…
                </Text>
              </XStack>
            ) : (
              <YStack gap="$2" flex={1} items="center" justify="center" py="$6">
                <Text fontSize="$4" color="$color11" fontWeight="600">
                  Run to see the response
                </Text>
                <Text fontSize="$2" color="$color10" text="center" maxW={280}>
                  Press Run (or ⌘↵) and the model&apos;s real output streams here, with token usage and cost.
                </Text>
              </YStack>
            )}
          </YStack>

          <XStack gap="$3" flexWrap="wrap">
            <StatBox
              label="USAGE"
              value={
                run.usage
                  ? `${formatTokens(run.usage.prompt_tokens)} → ${formatTokens(run.usage.completion_tokens)}`
                  : '—'
              }
              sub={run.usage ? 'prompt → completion tokens' : 'tokens appear after a run'}
            />
            <StatBox
              label="COST"
              value={formatUsd(cost.totalUsd)}
              sub={pricing ? 'usage × catalog $/Mtok' : 'no catalog price for this model'}
            />
          </XStack>
        </YStack>
      ) : (
        <YStack gap="$2" minH={260}>
          <YStack gap="$0.5" borderBottomWidth={1} borderColor="$borderColor" pb="$2">
            <Row label="Model" value={model || '—'} />
            <Row
              label="Status"
              value={
                run.phase === 'idle'
                  ? 'not run yet'
                  : run.phase === 'streaming'
                    ? 'streaming…'
                    : run.phase === 'error'
                      ? 'error'
                      : run.phase
              }
            />
            <Row label="First token" value={formatLatency(run.ttftMs)} />
            <Row label="Total time" value={formatLatency(run.totalMs)} />
            <Row label="Throughput" value={tps == null ? '—' : `${tps.toFixed(1)} tok/s`} />
            <Row
              label="Tokens"
              value={
                run.usage
                  ? `${formatTokens(run.usage.prompt_tokens)} / ${formatTokens(run.usage.completion_tokens)} / ${formatTokens(run.usage.total_tokens)}`
                  : '—'
              }
            />
            <Row label="Finish reason" value={run.finishReason ?? '—'} />
            <Row label="Cost" value={formatUsd(cost.totalUsd)} />
          </YStack>
          <XStack items="center" justify="space-between">
            <Text fontSize="$1" color="$color10" letterSpacing={0.5}>
              REQUEST
            </Text>
            <CopyButton text={requestJson} />
          </XStack>
          <Card p="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$1" color="$color11" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
              {requestJson}
            </Text>
          </Card>
        </YStack>
      )}
    </Card>
  )
}
