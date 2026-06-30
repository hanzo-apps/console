'use client'

/**
 * Compare playground — the marquee surface for Chat and Completions.
 *
 * ONE shared System + User message (or a single Prompt, in Completions mode)
 * broadcasts to EVERY selected model on Run. Each model is a column that runs in
 * PARALLEL (independent `/v1/chat/completions` streams through the keyless `/ai`
 * proxy), streaming its own output while reporting REAL tokens, cost and latency —
 * so quality, speed and price compare at a glance. Single-model mode is just one
 * column. Examples seed the prompt; History records each run locally.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Card, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { Play, Square, History, Eraser } from '@hanzogui/lucide-icons-2'

import { FieldRow, FieldSwitch, FieldTextArea } from '~/components/ui/Field'
import { BackendStateCard } from '~/components/ui/BackendState'
import { AddModel } from './AddModel'
import { CompareColumn } from './CompareColumn'
import { SettingsFields } from './SettingsControls'
import { useCatalog, defaultModels } from './useCatalog'
import { useCompare } from './useCompare'
import { EXAMPLES, type Example } from './examples'
import { clearHistory, loadHistory, saveRun, type HistoryEntry } from './history'
import { costOf, formatLatency, formatTokens, formatUsd } from './cost'
import type { RunMessage } from './types'

export function ComparePlayground({ mode }: { mode: 'chat' | 'completions' }) {
  const catalog = useCatalog()
  const compare = useCompare([])

  const [system, setSystem] = useState('')
  const [user, setUser] = useState('')
  const [prompt, setPrompt] = useState('')
  const [validation, setValidation] = useState<string | null>(null)

  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  useEffect(() => setHistory(loadHistory()), [])

  // Abort every in-flight column on unmount (switching to Audio/Embeddings/Vision
  // mid-stream, or navigating away) so we don't keep streaming + billing N-wide.
  // `cancel` is referentially stable (useCallback), so this runs only on unmount.
  const { cancel } = compare
  useEffect(() => () => cancel(), [cancel])

  // Seed default columns once the catalog resolves (2 distinct, Zen-first). On a
  // catalog error, seed one empty column so a model id can still be typed + run.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    if (catalog.phase === 'ready') {
      seeded.current = true
      const d = defaultModels(catalog.ids, 2)
      compare.addColumns(d.length ? d : [''])
    } else if (catalog.phase === 'error') {
      seeded.current = true
      compare.addColumns([''])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.phase, catalog.ids])

  const applyExample = (ex: Example) => {
    if (mode === 'chat') {
      setSystem(ex.system)
      setUser(ex.user)
    } else {
      setPrompt(ex.user)
    }
  }

  const onRun = async () => {
    const messages: RunMessage[] = []
    if (mode === 'chat') {
      if (system.trim()) messages.push({ role: 'system', content: system })
      if (!user.trim()) {
        setValidation('Enter a user message.')
        return
      }
      messages.push({ role: 'user', content: user })
    } else {
      if (!prompt.trim()) {
        setValidation('Enter a prompt.')
        return
      }
      messages.push({ role: 'user', content: prompt })
    }
    if (compare.columns.length === 0 || compare.columns.every((c) => !c.model.trim())) {
      setValidation('Add at least one model.')
      return
    }
    setValidation(null)

    const out = await compare.run(messages)
    if (out.length) {
      setHistory(
        saveRun({
          id: `run_${Date.now().toString(36)}`,
          at: Date.now(),
          mode,
          system: mode === 'chat' ? system : '',
          user: mode === 'chat' ? user : prompt,
          columns: out.map(({ model, result }) => ({
            model,
            ok: !result.error && !result.aborted,
            stopped: result.aborted,
            promptTokens: result.usage?.prompt_tokens ?? null,
            completionTokens: result.usage?.completion_tokens ?? null,
            totalUsd: costOf(result.usage, catalog.byId.get(model)?.pricing ?? null).totalUsd,
            ttftMs: result.ttftMs,
            totalMs: result.totalMs,
          })),
        }),
      )
    }
  }

  const count = compare.columns.length

  return (
    <YStack gap="$4">
      {/* Toolbar: examples + history + run/stop */}
      <XStack justify="space-between" items="center" flexWrap="wrap" gap="$2">
        <XStack gap="$1.5" items="center" flexWrap="wrap">
          <Text fontSize="$2" color="$color10">
            Examples
          </Text>
          {EXAMPLES.map((ex) => (
            <Button key={ex.id} size="$1" disabled={compare.running} onPress={() => applyExample(ex)}>
              {ex.label}
            </Button>
          ))}
        </XStack>
        <XStack gap="$2">
          <Button size="$2" icon={<History size={15} />} onPress={() => setShowHistory((s) => !s)}>
            History
          </Button>
          {compare.running ? (
            <Button size="$2" icon={<Square size={14} />} onPress={compare.cancel}>
              Stop
            </Button>
          ) : (
            <Button size="$2" bg="$color5" icon={<Play size={15} />} onPress={() => void onRun()}>
              {count > 1 ? 'Run all' : 'Run'}
            </Button>
          )}
        </XStack>
      </XStack>

      {validation ? (
        <Text fontSize="$3" color="$red10">
          {validation}
        </Text>
      ) : null}

      {/* Shared prompt + shared settings */}
      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        <YStack flex={2} minW={360} gap="$3">
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            {mode === 'chat' ? (
              <>
                <FieldRow label="System prompt">
                  <FieldTextArea value={system} onChange={setSystem} rows={3} />
                </FieldRow>
                <FieldRow label="User message">
                  <FieldTextArea value={user} onChange={setUser} rows={6} />
                </FieldRow>
              </>
            ) : (
              <FieldRow label="Prompt">
                <FieldTextArea value={prompt} onChange={setPrompt} rows={9} />
              </FieldRow>
            )}
            <Text fontSize="$2" color="$color10">
              This prompt is sent to every selected model on Run.
            </Text>
          </Card>
        </YStack>

        <YStack flex={1} minW={300} gap="$3">
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <XStack justify="space-between" items="center">
              <Text fontSize="$4" fontWeight="700">
                Model settings
              </Text>
            </XStack>
            <XStack gap="$2" items="center">
              <FieldSwitch checked={compare.sync} onChange={compare.setSync} disabled={compare.running} />
              <Text fontSize="$3" color="$color11">
                Sync settings across all columns
              </Text>
            </XStack>
            <SettingsFields value={compare.shared} onChange={compare.setShared} disabled={compare.running} />
            {!compare.sync ? (
              <Text fontSize="$2" color="$color10">
                Each column can override these — open a column&apos;s Settings.
              </Text>
            ) : null}
          </Card>
        </YStack>
      </XStack>

      {/* Compare board */}
      <YStack gap="$3">
        <XStack justify="space-between" items="center" flexWrap="wrap" gap="$2">
          <Text fontSize="$4" fontWeight="700">
            {count === 1 ? '1 model' : `${count} models`}
            {compare.running ? ' · streaming…' : ''}
          </Text>
          <AddModel models={catalog.models} onAdd={(id) => compare.addColumns([id])} disabled={compare.running} />
        </XStack>

        {catalog.phase === 'error' && catalog.error ? (
          <BackendStateCard
            state={catalog.error}
            onRetry={catalog.reload}
            hint="You can still type a model id into a column and run."
          />
        ) : null}

        {count === 0 ? (
          <Card p="$5" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$3" color="$color10">
              Loading the model catalog…
            </Text>
          </Card>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <XStack gap="$3" items="stretch" pb="$2">
              {compare.columns.map((col) => (
                <CompareColumn
                  key={col.id}
                  col={col}
                  meta={catalog.byId.get(col.model)}
                  ids={catalog.ids}
                  synced={compare.sync}
                  canRemove={count > 1}
                  running={compare.running}
                  onModel={(m) => compare.setColumnModel(col.id, m)}
                  onRemove={() => compare.removeColumn(col.id)}
                  onSettings={(p) => compare.setColumnSettings(col.id, p)}
                  onResetSettings={() => compare.resetColumnSettings(col.id)}
                  effectiveSettings={compare.effective(col)}
                />
              ))}
            </XStack>
          </ScrollView>
        )}
      </YStack>

      {/* History */}
      {showHistory ? (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <XStack justify="space-between" items="center">
            <Text fontSize="$4" fontWeight="700">
              Run history
            </Text>
            {history.length > 0 ? (
              <Button
                size="$2"
                chromeless
                icon={<Eraser size={14} />}
                onPress={() => setHistory(clearHistory())}
              >
                Clear
              </Button>
            ) : null}
          </XStack>
          {history.length === 0 ? (
            <Text fontSize="$3" color="$color10">
              No runs yet. Run a comparison and it appears here.
            </Text>
          ) : (
            <YStack gap="$2.5">
              {history.map((h) => (
                <YStack key={h.id} gap="$1.5" borderTopWidth={1} borderColor="$borderColor" pt="$2.5">
                  <XStack justify="space-between" items="center" gap="$2">
                    <Text fontSize="$2" color="$color12" numberOfLines={1} flex={1}>
                      {h.user || '(no prompt)'}
                    </Text>
                    <Text fontSize="$1" color="$color10">
                      {h.mode} · {new Date(h.at).toLocaleTimeString()}
                    </Text>
                  </XStack>
                  <XStack gap="$2" flexWrap="wrap">
                    {h.columns.map((c, i) => (
                      <XStack key={i} gap="$1.5" items="center" px="$2" py="$1" rounded="$2" bg="$color2" borderWidth={1} borderColor="$borderColor">
                        <Text fontSize="$1" color="$color12">
                          {c.model}
                        </Text>
                        <Text fontSize="$1" color="$color10">
                          {formatTokens(c.promptTokens)}/{formatTokens(c.completionTokens)} tok
                        </Text>
                        <Text fontSize="$1" color="$color10">
                          {formatUsd(c.totalUsd)}
                        </Text>
                        <Text fontSize="$1" color="$color10">
                          {formatLatency(c.totalMs)}
                        </Text>
                        {c.stopped ? (
                          <Text fontSize="$1" color="$color10">
                            stopped
                          </Text>
                        ) : !c.ok ? (
                          <Text fontSize="$1" color="$red10">
                            error
                          </Text>
                        ) : null}
                      </XStack>
                    ))}
                  </XStack>
                </YStack>
              ))}
            </YStack>
          )}
        </Card>
      ) : null}
    </YStack>
  )
}
