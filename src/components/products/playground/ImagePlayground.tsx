'use client'

/**
 * Image tab — text-to-image through the keyless `/ai` proxy
 * (`POST /v1/images/generations`, JSON in → an image out). Pick a Zen image
 * model, type a prompt, generate, and render the real image the gateway returns.
 * Real wiring: the image is the gateway's own result (a hosted URL or inline
 * base64); if the deployment doesn't serve image generation, an honest error
 * state is shown instead of silent failure. The gateway meters the call
 * synchronously (per-image billing), so we nudge the live balance after a run.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Image as ImageIcon, Clock } from '@hanzogui/lucide-icons-2'

import { PlaygroundApi } from '~/lib/api'
import { FieldRow, FieldSelect, FieldTextArea } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { ModelSelect } from './ModelSelect'
import { useCatalog, defaultModels } from './useCatalog'
import { formatLatency } from './cost'

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const SIZES = ['1024x1024', '1024x1792', '1792x1024']

// An image result carries a hosted URL or inline base64 — render whichever the
// gateway returned. (b64 is wrapped as a data: URI so the same <img> renders both.)
function imageSrc(d: { url?: string; b64_json?: string }): string | null {
  if (d.url) return d.url
  if (d.b64_json) return `data:image/png;base64,${d.b64_json}`
  return null
}

export function ImagePlayground() {
  const catalog = useCatalog()
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(SIZES[0])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)

  // Default to an image model (zen3-image family) if present, else Zen/first.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || catalog.phase !== 'ready') return
    seeded.current = true
    const img = catalog.ids.find((x) => /image/i.test(x))
    setModel((m) => m || img || defaultModels(catalog.ids, 1)[0] || '')
  }, [catalog.phase, catalog.ids])

  // Only surface image models in the picker so the tab is self-consistent.
  const imageIds = catalog.ids.filter((x) => /image/i.test(x))
  const pickerIds = imageIds.length > 0 ? imageIds : catalog.ids

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
    setSrc(null)
    setLatencyMs(null)
    const start = now()
    try {
      const res = await PlaygroundApi.images({ model: model.trim(), prompt: prompt.trim(), n: 1, size })
      const first = res?.data?.[0]
      const s = first ? imageSrc(first) : null
      if (!s) throw new Error(res?.error?.message ?? 'The gateway returned no image.')
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
            <ModelSelect value={model} ids={pickerIds} onChange={setModel} disabled={running} placeholder="image model id" />
          </FieldRow>
          <FieldRow label="Size">
            <FieldSelect value={size} options={SIZES} onChange={setSize} disabled={running} />
          </FieldRow>
          <FieldRow label="Prompt">
            <FieldTextArea value={prompt} onChange={setPrompt} rows={6} />
          </FieldRow>
          <XStack justify="flex-end">
            <Button bg="$color5" icon={<ImageIcon size={16} />} disabled={running} onPress={() => void run()}>
              {running ? 'Generating…' : 'Generate'}
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
              <Text color="$color11">Generating…</Text>
            </XStack>
          ) : error ? (
            <BackendStateCard state={error} onRetry={() => void run()} />
          ) : src ? (
            <YStack gap="$2">
              {/* Real generated image — the gateway's own result. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={prompt} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
              <XStack gap="$1.5" items="center">
                <Clock size={14} />
                <Text fontSize="$2" color="$color11">
                  {formatLatency(latencyMs)}
                </Text>
              </XStack>
            </YStack>
          ) : (
            <Text fontSize="$3" color="$color10">
              Generate to see the model&apos;s real image output.
            </Text>
          )}
        </Card>
      </YStack>
    </XStack>
  )
}
