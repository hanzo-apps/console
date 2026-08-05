'use client'

/**
 * Audio tab — text-to-speech through the keyless `/ai` proxy
 * (`POST /v1/audio/speech`, JSON in → audio bytes out). Type text, pick a
 * voice, synthesize, and play the returned audio. Real wiring: the audio is the
 * gateway's own bytes (played from a Blob URL); if the deployment doesn't serve
 * speech, an honest error state is shown instead of silent failure.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Volume2, Clock } from '@hanzogui/lucide-icons-2'

import { PlaygroundApi } from '~/lib/api'
import { ModelSelect } from './ModelSelect'
import { useCatalog, defaultModels } from './useCatalog'
import { formatLatency } from './cost'
import { BackendStateCard, FieldRow, FieldSelect, FieldTextArea, classifyBackend, type BackendState } from '@hanzo/ui/product'

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']

export function AudioPlayground() {
  const catalog = useCatalog()
  const [model, setModel] = useState('')
  const [voice, setVoice] = useState('alloy')
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const urlRef = useRef<string | null>(null)

  // Default to a TTS-named model if present, else Zen/first.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || catalog.phase !== 'ready') return
    seeded.current = true
    const tts = catalog.ids.find((x) => /(tts|speech|audio)/i.test(x))
    setModel((m) => m || tts || defaultModels(catalog.ids, 1)[0] || '')
  }, [catalog.phase, catalog.ids])

  // Revoke the previous object URL when it changes / on unmount.
  useEffect(() => {
    urlRef.current = audioUrl
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [audioUrl])

  const run = async () => {
    if (!model.trim()) {
      setError({ kind: 'error', message: 'Choose a model.' })
      return
    }
    if (!text.trim()) {
      setError({ kind: 'error', message: 'Enter text to synthesize.' })
      return
    }
    setRunning(true)
    setError(null)
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setLatencyMs(null)
    const start = now()
    try {
      const blob = await PlaygroundApi.speech({ model: model.trim(), input: text.trim(), voice })
      setAudioUrl(URL.createObjectURL(blob))
      setLatencyMs(now() - start)
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <XStack gap="$4" flexWrap="wrap" items="flex-start">
      <YStack flex={1} minW={360} gap="$3">
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <FieldRow label="Model">
            <ModelSelect value={model} ids={catalog.ids} onChange={setModel} disabled={running} placeholder="tts model id" />
          </FieldRow>
          <FieldRow label="Voice">
            <FieldSelect value={voice} options={VOICES} onChange={setVoice} disabled={running} />
          </FieldRow>
          <FieldRow label="Text">
            <FieldTextArea value={text} onChange={setText} rows={6} />
          </FieldRow>
          <XStack justify="flex-end">
            <Button bg="$color5" icon={<Volume2 size={16} />} disabled={running} onPress={() => void run()}>
              {running ? 'Synthesizing…' : 'Synthesize'}
            </Button>
          </XStack>
        </Card>
      </YStack>

      <YStack flex={1} minW={360} gap="$3">
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" minH={200}>
          <Text fontSize="$4" fontWeight="700">
            Output
          </Text>
          {running ? (
            <XStack gap="$2" items="center">
              <Spinner color="$color11" />
              <Text color="$color11">Synthesizing…</Text>
            </XStack>
          ) : error ? (
            <BackendStateCard state={error} onRetry={() => void run()} />
          ) : audioUrl ? (
            <YStack gap="$2">
              {/* Native audio element — plays the gateway's real audio bytes. */}
              <audio controls src={audioUrl} style={{ width: '100%' }} />
              <XStack gap="$1.5" items="center">
                <Clock size={14} />
                <Text fontSize="$2" color="$color11">
                  {formatLatency(latencyMs)}
                </Text>
              </XStack>
            </YStack>
          ) : (
            <Text fontSize="$3" color="$color10">
              Synthesize to hear the model&apos;s real audio output.
            </Text>
          )}
        </Card>
      </YStack>
    </XStack>
  )
}
