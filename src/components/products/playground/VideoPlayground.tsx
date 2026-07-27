'use client'

/**
 * Video tab — text-to-video through the keyless `/ai` proxy
 * (`POST /v1/videos/generations`, JSON in → a video out). Pick a Zen video
 * model, type a prompt, generate, and render the real clip the gateway returns.
 * Video generation is minutes-long and premium-billed; the gateway meters the
 * call, so we nudge the live balance after a run. If the deployment can't deliver
 * the clip, an honest error state is shown instead of silent failure.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Clapperboard, Clock } from '@hanzogui/lucide-icons-2'

import { PlaygroundApi } from '~/lib/api'
import { FieldRow, FieldTextArea } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { ModelSelect } from './ModelSelect'
import { useCatalog, defaultModels } from './useCatalog'
import { formatLatency } from './cost'

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// A video result carries a hosted URL or inline base64 MP4 — render whichever the
// gateway returned as a Blob URL (b64 is decoded so <video> plays it directly).
function videoSrc(d: { url?: string; b64_json?: string; mime_type?: string }): string | null {
  if (d.url) return d.url
  if (d.b64_json) {
    const mime = d.mime_type || 'video/mp4'
    const bin = atob(d.b64_json)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: mime }))
  }
  return null
}

export function VideoPlayground() {
  const catalog = useCatalog()
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const urlRef = useRef<string | null>(null)

  // Default to a video model (zen3-video family) if present, else Zen/first.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || catalog.phase !== 'ready') return
    seeded.current = true
    const vid = catalog.ids.find((x) => /video|t2v/i.test(x))
    setModel((m) => m || vid || defaultModels(catalog.ids, 1)[0] || '')
  }, [catalog.phase, catalog.ids])

  // Revoke the previous Blob URL when it changes / on unmount.
  useEffect(() => {
    urlRef.current = src
    return () => {
      if (urlRef.current?.startsWith('blob:')) URL.revokeObjectURL(urlRef.current)
    }
  }, [src])

  const videoIds = catalog.ids.filter((x) => /video|t2v/i.test(x))
  const pickerIds = videoIds.length > 0 ? videoIds : catalog.ids

  const run = async () => {
    if (!model.trim()) {
      setError({ kind: 'error', message: 'Choose a model.' })
      return
    }
    if (!prompt.trim()) {
      setError({ kind: 'error', message: 'Enter a prompt to generate.' })
      return
    }
    setRunning(true)
    setError(null)
    if (src?.startsWith('blob:')) URL.revokeObjectURL(src)
    setSrc(null)
    setLatencyMs(null)
    const start = now()
    try {
      const res = await PlaygroundApi.videos({ model: model.trim(), prompt: prompt.trim() })
      const first = res?.data?.[0]
      const s = first ? videoSrc(first) : null
      if (!s) throw new Error(res?.error?.message ?? 'The gateway returned no video.')
      setSrc(s)
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
            <ModelSelect value={model} ids={pickerIds} onChange={setModel} disabled={running} placeholder="video model id" />
          </FieldRow>
          <FieldRow label="Prompt">
            <FieldTextArea value={prompt} onChange={setPrompt} rows={6} />
          </FieldRow>
          <XStack justify="flex-end">
            <Button bg="$color5" icon={<Clapperboard size={16} />} disabled={running} onPress={() => void run()}>
              {running ? 'Generating…' : 'Generate'}
            </Button>
          </XStack>
          <Text fontSize="$2" color="$color10">
            Text-to-video is minutes-long and premium-billed. One clip per run.
          </Text>
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
              <Text color="$color11">Generating… (this can take a minute)</Text>
            </XStack>
          ) : error ? (
            <BackendStateCard state={error} onRetry={() => void run()} />
          ) : src ? (
            <YStack gap="$2">
              {/* Real generated clip — the gateway's own bytes. */}
              <video controls src={src} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
              <XStack gap="$1.5" items="center">
                <Clock size={14} />
                <Text fontSize="$2" color="$color11">
                  {formatLatency(latencyMs)}
                </Text>
              </XStack>
            </YStack>
          ) : (
            <Text fontSize="$3" color="$color10">
              Generate to see the model&apos;s real video output.
            </Text>
          )}
        </Card>
      </YStack>
    </XStack>
  )
}
