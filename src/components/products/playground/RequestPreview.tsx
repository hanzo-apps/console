'use client'

/**
 * RequestPreview — the header "</>" popover: the REAL request for the current
 * composer as a runnable cURL or as JSON, with copy. Built from the same
 * `paramsOf` mapping the run uses, so what is shown is exactly what gets sent.
 */
import { useState } from 'react'
import { Button, Card, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { Copy, Check } from '@hanzogui/lucide-icons-2'

type Tab = 'curl' | 'json'

export function RequestPreview({ curl, json }: { curl: string; json: string }) {
  const [tab, setTab] = useState<Tab>('curl')
  const [done, setDone] = useState(false)
  const text = tab === 'curl' ? curl : json

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
    <YStack gap="$2" minW={420} maxW={560} p="$1">
      <XStack items="center" justify="space-between">
        <XStack gap="$1" bg="$color3" rounded="$10" p="$1">
          {(['curl', 'json'] as Tab[]).map((t) => (
            <Button
              key={t}
              size="$1"
              chromeless={tab !== t}
              bg={tab === t ? '$color1' : 'transparent'}
              rounded="$10"
              px="$3"
              onPress={() => setTab(t)}
            >
              <Text fontSize="$1" color={tab === t ? '$color12' : '$color10'} fontWeight="600">
                {t === 'curl' ? 'cURL' : 'JSON'}
              </Text>
            </Button>
          ))}
        </XStack>
        <Button size="$2" icon={done ? <Check size={14} color="$green10" /> : <Copy size={14} />} onPress={copy}>
          <Text fontSize="$2" color="$color11">
            {done ? 'Copied' : 'Copy'}
          </Text>
        </Button>
      </XStack>
      <Card p="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
        <ScrollView maxH={320}>
          <Text fontSize="$1" color="$color11" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {text}
          </Text>
        </ScrollView>
      </Card>
    </YStack>
  )
}
