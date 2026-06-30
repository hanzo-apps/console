'use client'

/**
 * Compare column — one model's lane in the side-by-side board.
 *
 * Header: the model picker + a context badge (provider + tier from the catalog),
 * remove, and an optional per-column settings override (shown only when settings
 * aren't synced). Body: the streamed output, a "waiting for first token" spinner,
 * or an honest per-column error (one column failing never blanks the rest).
 * Footer: REAL prompt/completion tokens, cost (usage × catalog $/Mtok), and
 * latency — time-to-first-token + total — plus throughput.
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button, Card, Separator, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { X, Settings2, Coins, Zap, Clock, Gauge, Binary } from '@hanzogui/lucide-icons-2'

import { providerLabels, type CatalogModel } from '~/lib/api'
import { BackendStateCard } from '~/components/ui/BackendState'
import { ModelSelect } from './ModelSelect'
import { SettingsFields } from './SettingsControls'
import { costOf, formatLatency, formatTokens, formatUsd, tokensPerSecond } from './cost'
import type { Column, Settings } from './types'

function Lines({ text }: { text: string }) {
  return (
    <YStack>
      {text.split('\n').map((line, i) => (
        <Text key={i} fontSize="$3" color="$color12">
          {line === '' ? ' ' : line}
        </Text>
      ))}
    </YStack>
  )
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <XStack gap="$1.5" items="center" minW={92}>
      {icon}
      <YStack>
        <Text fontSize="$1" color="$color10">
          {label}
        </Text>
        <Text fontSize="$2" color="$color12" fontWeight="600">
          {value}
        </Text>
      </YStack>
    </XStack>
  )
}

const Pill = ({ children, accent }: { children: ReactNode; accent?: boolean }) => (
  <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg={accent ? '$color5' : '$color3'} color={accent ? '$color12' : '$color11'}>
    {children}
  </Text>
)

export function CompareColumn({
  col,
  meta,
  ids,
  synced,
  canRemove,
  running,
  onModel,
  onRemove,
  onSettings,
  onResetSettings,
  effectiveSettings,
}: {
  col: Column
  meta: CatalogModel | undefined
  ids: string[]
  synced: boolean
  canRemove: boolean
  running: boolean
  onModel: (model: string) => void
  onRemove: () => void
  onSettings: (patch: Partial<Settings>) => void
  onResetSettings: () => void
  effectiveSettings: Settings
}) {
  const [showSettings, setShowSettings] = useState(false)
  const cost = costOf(col.usage, meta?.pricing)
  const tps = tokensPerSecond(col.usage, col.totalMs)
  const overridden = !synced && !!col.settings

  return (
    <YStack width={340} minW={340} gap="$2.5">
      {/* Header: model + context badge + remove + optional override */}
      <Card p="$2.5" gap="$2" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$2" items="center">
          <YStack flex={1}>
            <ModelSelect value={col.model} ids={ids} onChange={onModel} disabled={running} />
          </YStack>
          {canRemove ? <Button size="$2" chromeless icon={<X size={15} />} disabled={running} onPress={onRemove} /> : null}
        </XStack>
        <XStack gap="$1.5" items="center" flexWrap="wrap">
          <Pill>{meta ? providerLabels[meta.owned_by] ?? meta.owned_by : 'custom id'}</Pill>
          {meta ? <Pill accent={!!meta.premium}>{meta.premium ? 'Premium' : 'Standard'}</Pill> : null}
          {!synced ? (
            <Button size="$1" chromeless icon={<Settings2 size={13} />} onPress={() => setShowSettings((s) => !s)}>
              {overridden ? 'Custom' : 'Settings'}
            </Button>
          ) : null}
        </XStack>
        {!synced && showSettings ? (
          <YStack gap="$2" pt="$2" borderTopWidth={1} borderColor="$borderColor">
            <SettingsFields value={effectiveSettings} onChange={onSettings} disabled={running} />
            {overridden ? (
              <Button size="$1" chromeless self="flex-start" onPress={onResetSettings}>
                Reset to shared
              </Button>
            ) : null}
          </YStack>
        ) : null}
      </Card>

      {/* Output */}
      <Card p="$3" gap="$2" borderWidth={1} borderColor="$borderColor" minH={220} flex={1}>
        {col.phase === 'idle' ? (
          <Text fontSize="$3" color="$color10">
            Run to compare this model&apos;s output.
          </Text>
        ) : col.phase === 'error' && col.error ? (
          <BackendStateCard state={col.error} />
        ) : (
          <YStack gap="$2">
            {col.phase === 'stopped' ? (
              <Text fontSize="$1" self="flex-start" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
                Stopped
              </Text>
            ) : null}
            {col.content ? (
              <Lines text={col.content} />
            ) : col.phase === 'streaming' ? (
              <XStack gap="$2" items="center">
                <Spinner color="$color11" />
                <Text color="$color11" fontSize="$3">
                  Waiting for first token…
                </Text>
              </XStack>
            ) : col.phase === 'stopped' ? (
              <Text fontSize="$3" color="$color10">
                Stopped before any output.
              </Text>
            ) : (
              <Text fontSize="$3" color="$color10">
                (empty response)
              </Text>
            )}
          </YStack>
        )}
      </Card>

      {/* Metrics — tokens, cost, latency */}
      <Card p="$2.5" gap="$2" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$3" flexWrap="wrap">
          <Metric
            icon={<Binary size={14} />}
            label="tokens in / out"
            value={`${formatTokens(col.usage?.prompt_tokens)} / ${formatTokens(col.usage?.completion_tokens)}`}
          />
          <Metric icon={<Coins size={14} />} label="cost" value={formatUsd(cost.totalUsd)} />
        </XStack>
        <Separator />
        <XStack gap="$3" flexWrap="wrap">
          <Metric icon={<Zap size={14} />} label="first token" value={formatLatency(col.ttftMs)} />
          <Metric icon={<Clock size={14} />} label="total" value={formatLatency(col.totalMs)} />
          <Metric icon={<Gauge size={14} />} label="tok/s" value={tps == null ? '—' : tps.toFixed(1)} />
        </XStack>
      </Card>
    </YStack>
  )
}
