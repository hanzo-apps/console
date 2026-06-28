'use client'

/**
 * Playground — try models and prompts interactively against the LIVE gateway.
 *
 * Ported from the old console's playground (features/playground): compose a
 * system prompt + a message thread, set sampling params, run, read the output.
 * The old console proxied to its own LLM connections; here the REAL runtime is
 * the cloud gateway — GET /v1/models for the catalog, POST /v1/chat/completions
 * to run (PlaygroundApi). No fabricated output: the model list, the completion,
 * and the token usage are all real, and every failure renders an honest state.
 */
import { useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Play, Plus, Trash } from '@hanzogui/lucide-icons-2'

import { PlaygroundApi, type ChatCompletion, type ChatMessage } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { FieldRow, FieldText, FieldTextArea, FieldSelect, FieldSlider } from '~/components/ui/Field'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { ModelPicker } from './ModelPicker'

const ROLES = ['user', 'assistant', 'system'] as const

/** Render multi-line model output preserving line breaks (no whitespace tricks). */
function OutputText({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <YStack>
      {lines.map((line, i) => (
        <Text key={i} fontSize="$3" color="$color12">
          {line === '' ? ' ' : line}
        </Text>
      ))}
    </YStack>
  )
}

export function PlaygroundModule(_props: { params: Record<string, string> }) {
  const [model, setModel] = useState('')
  const [system, setSystem] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'user', content: '' }])
  const [temperature, setTemperature] = useState(0.7)
  const [topP, setTopP] = useState(1)
  const [maxTokens, setMaxTokens] = useState('1024')

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ChatCompletion | null>(null)
  const [runError, setRunError] = useState<BackendState | null>(null)

  const setMessage = (i: number, patch: Partial<ChatMessage>) =>
    setMessages((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const addMessage = () =>
    setMessages((ms) => [...ms, { role: ms[ms.length - 1]?.role === 'user' ? 'assistant' : 'user', content: '' }])
  const removeMessage = (i: number) => setMessages((ms) => ms.filter((_, j) => j !== i))

  const run = async () => {
    const thread: ChatMessage[] = []
    if (system.trim()) thread.push({ role: 'system', content: system })
    for (const m of messages) if (m.content.trim()) thread.push(m)

    if (!model.trim()) {
      setRunError({ kind: 'error', message: 'Choose or enter a model id first.' })
      return
    }
    if (thread.length === 0) {
      setRunError({ kind: 'error', message: 'Add at least one non-empty message.' })
      return
    }

    setRunning(true)
    setRunError(null)
    setResult(null)
    try {
      const r = await PlaygroundApi.chat({
        model: model.trim(),
        messages: thread,
        temperature,
        top_p: topP,
        max_tokens: Number(maxTokens) || undefined,
      })
      if (r.error?.message) {
        setRunError({ kind: 'error', message: r.error.message })
      } else {
        setResult(r)
      }
    } catch (e) {
      setRunError(classifyBackend(e))
    } finally {
      setRunning(false)
    }
  }

  const content = result?.choices?.[0]?.message?.content ?? ''
  const usage = result?.usage

  return (
    <>
      <PageHeader
        title="Playground"
        subtitle="Try models and prompts against the live gateway."
        actions={
          <Button icon={<Play size={16} />} disabled={running} onPress={() => void run()}>
            {running ? 'Running…' : 'Run'}
          </Button>
        }
      />

      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        {/* ── Left: prompt + params ─────────────────────────────────────── */}
        <YStack gap="$3" flex={1} minW={360}>
          <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor">
            <FieldRow label="Model">
              <ModelPicker value={model} onChange={setModel} autoselect />
            </FieldRow>

            <FieldRow label="System prompt">
              <FieldTextArea value={system} onChange={setSystem} rows={4} />
            </FieldRow>

            <FieldRow label="Temperature">
              <FieldSlider value={temperature} min={0} max={2} step={0.01} onChange={setTemperature} />
            </FieldRow>
            <FieldRow label="Top P">
              <FieldSlider value={topP} min={0} max={1} step={0.01} onChange={setTopP} />
            </FieldRow>
            <FieldRow label="Max tokens">
              <FieldText value={maxTokens} onChange={setMaxTokens} placeholder="1024" />
            </FieldRow>
          </Card>

          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <XStack justify="space-between" items="center">
              <Text fontSize="$4" fontWeight="700">
                Messages
              </Text>
              <Button size="$2" icon={<Plus size={14} />} onPress={addMessage}>
                Add
              </Button>
            </XStack>
            {messages.map((m, i) => (
              <YStack key={i} gap="$2" borderTopWidth={i === 0 ? 0 : 1} borderColor="$borderColor" pt={i === 0 ? 0 : '$3'}>
                <XStack gap="$2" items="center" justify="space-between">
                  <YStack width={160}>
                    <FieldSelect
                      value={m.role}
                      options={[...ROLES]}
                      onChange={(v) => setMessage(i, { role: v as ChatMessage['role'] })}
                    />
                  </YStack>
                  {messages.length > 1 ? (
                    <Button size="$2" chromeless icon={<Trash size={14} />} onPress={() => removeMessage(i)} />
                  ) : null}
                </XStack>
                <FieldTextArea value={m.content} onChange={(v) => setMessage(i, { content: v })} rows={3} />
              </YStack>
            ))}
          </Card>
        </YStack>

        {/* ── Right: output ─────────────────────────────────────────────── */}
        <YStack gap="$3" flex={1} minW={360}>
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" minH={240}>
            <XStack justify="space-between" items="center">
              <Text fontSize="$4" fontWeight="700">
                Output
              </Text>
              {result?.model ? (
                <Text fontSize="$2" color="$color10">
                  {result.model}
                </Text>
              ) : null}
            </XStack>

            {running ? (
              <XStack p="$4" gap="$2" items="center">
                <Spinner color="$color11" />
                <Text color="$color11">Running…</Text>
              </XStack>
            ) : runError ? (
              <BackendStateCard state={runError} onRetry={() => void run()} />
            ) : result ? (
              <YStack gap="$3">
                <OutputText content={content} />
                {usage ? (
                  <XStack gap="$3" flexWrap="wrap" borderTopWidth={1} borderColor="$borderColor" pt="$2">
                    <Text fontSize="$2" color="$color10">
                      prompt {usage.prompt_tokens ?? '—'}
                    </Text>
                    <Text fontSize="$2" color="$color10">
                      completion {usage.completion_tokens ?? '—'}
                    </Text>
                    <Text fontSize="$2" color="$color10">
                      total {usage.total_tokens ?? '—'}
                    </Text>
                  </XStack>
                ) : null}
              </YStack>
            ) : (
              <Text fontSize="$3" color="$color10">
                Run to see the model output. Nothing is shown until a real completion returns.
              </Text>
            )}
          </Card>
        </YStack>
      </XStack>
    </>
  )
}
