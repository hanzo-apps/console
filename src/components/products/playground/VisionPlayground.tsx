'use client'

/**
 * Vision tab — a real multimodal chat run: the prompt carries an image URL as an
 * OpenAI content part (`{type:'image_url'}`), streamed through the SAME runner the
 * compare board uses (so it reports REAL tokens, cost and latency). Vision is just
 * chat/completions with image content, so it needs no extra backend surface.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Card, Separator, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Play, Square, Coins, Zap, Clock, Binary } from '@hanzogui/lucide-icons-2'

import { ApiError, type ChatUsage } from '~/lib/api'
import { ModelSelect } from './ModelSelect'
import { useCatalog, defaultModels } from './useCatalog'
import { runColumn } from './runner'
import { costOf, formatLatency, formatTokens, formatUsd } from './cost'
import type { ContentPart, RunMessage } from './types'
import { BackendStateCard, FieldRow, FieldText, FieldTextArea, classifyBackend, type BackendState } from '@hanzo/ui/product'

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

export function VisionPlayground() {
  const catalog = useCatalog()
  const [model, setModel] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [question, setQuestion] = useState('What is in this image?')
  const [running, setRunning] = useState(false)
  const [content, setContent] = useState('')
  const [usage, setUsage] = useState<ChatUsage | null>(null)
  const [ttftMs, setTtftMs] = useState<number | null>(null)
  const [totalMs, setTotalMs] = useState<number | null>(null)
  const [error, setError] = useState<BackendState | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  // Prefer a vision/multimodal-named model, else Zen/first.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || catalog.phase !== 'ready') return
    seeded.current = true
    const vis = catalog.ids.find((x) => /(vision|vl|omni|multimodal|4o)/i.test(x))
    setModel((m) => m || vis || defaultModels(catalog.ids, 1)[0] || '')
  }, [catalog.phase, catalog.ids])

  const run = async () => {
    if (!model.trim()) {
      setError({ kind: 'error', message: 'Choose a model.' })
      return
    }
    if (!imageUrl.trim()) {
      setError({ kind: 'error', message: 'Enter an image URL.' })
      return
    }
    if (!question.trim()) {
      setError({ kind: 'error', message: 'Enter a question about the image.' })
      return
    }
    const parts: ContentPart[] = [
      { type: 'text', text: question.trim() },
      { type: 'image_url', image_url: { url: imageUrl.trim() } },
    ]
    const messages: RunMessage[] = [{ role: 'user', content: parts }]
    setRunning(true)
    setError(null)
    setContent('')
    setUsage(null)
    setTtftMs(null)
    setTotalMs(null)
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const result = await runColumn(
      { model: model.trim(), messages, temperature: 0.7 },
      { onFirstToken: (t) => setTtftMs(t), onDelta: (c) => setContent(c) },
      ctrl.signal,
    )
    setContent(result.content)
    setUsage(result.usage)
    setTtftMs(result.ttftMs)
    setTotalMs(result.totalMs)
    if (result.error) setError(classifyBackend(new ApiError(result.error.message, result.error.status)))
    setRunning(false)
  }

  const cost = costOf(usage, catalog.byId.get(model)?.pricing)

  return (
    <XStack gap="$4" flexWrap="wrap" items="flex-start">
      <YStack flex={1} minW={360} gap="$3">
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <FieldRow label="Model">
            <ModelSelect value={model} ids={catalog.ids} onChange={setModel} disabled={running} placeholder="vision model id" />
          </FieldRow>
          <FieldRow label="Image URL">
            <FieldText value={imageUrl} onChange={setImageUrl} placeholder="https://… (png/jpg/webp)" disabled={running} />
          </FieldRow>
          <FieldRow label="Question">
            <FieldTextArea value={question} onChange={setQuestion} rows={3} disabled={running} />
          </FieldRow>
          {imageUrl.trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl.trim()}
              alt="preview"
              style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, objectFit: 'contain' }}
            />
          ) : null}
          <XStack justify="flex-end" gap="$2">
            {running ? (
              <Button icon={<Square size={14} />} onPress={() => ctrlRef.current?.abort()}>
                Stop
              </Button>
            ) : (
              <Button bg="$color5" icon={<Play size={16} />} onPress={() => void run()}>
                Run
              </Button>
            )}
          </XStack>
        </Card>
      </YStack>

      <YStack flex={1} minW={360} gap="$3">
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" minH={240}>
          <Text fontSize="$4" fontWeight="700">
            Output
          </Text>
          {error ? (
            <BackendStateCard state={error} onRetry={() => void run()} />
          ) : content ? (
            <Lines text={content} />
          ) : running ? (
            <XStack gap="$2" items="center">
              <Spinner color="$color11" />
              <Text color="$color11" fontSize="$3">
                Waiting for first token…
              </Text>
            </XStack>
          ) : (
            <Text fontSize="$3" color="$color10">
              Give an image URL and a question, then Run to see the model describe it.
            </Text>
          )}
          {usage || totalMs != null ? (
            <>
              <Separator />
              <XStack gap="$4" flexWrap="wrap">
                <XStack gap="$1.5" items="center">
                  <Binary size={14} />
                  <Text fontSize="$2" color="$color11">
                    {formatTokens(usage?.prompt_tokens)} / {formatTokens(usage?.completion_tokens)} tok
                  </Text>
                </XStack>
                <XStack gap="$1.5" items="center">
                  <Coins size={14} />
                  <Text fontSize="$2" color="$color11">
                    {formatUsd(cost.totalUsd)}
                  </Text>
                </XStack>
                <XStack gap="$1.5" items="center">
                  <Zap size={14} />
                  <Text fontSize="$2" color="$color11">
                    {formatLatency(ttftMs)}
                  </Text>
                </XStack>
                <XStack gap="$1.5" items="center">
                  <Clock size={14} />
                  <Text fontSize="$2" color="$color11">
                    {formatLatency(totalMs)}
                  </Text>
                </XStack>
              </XStack>
            </>
          ) : null}
        </Card>
      </YStack>
    </XStack>
  )
}
