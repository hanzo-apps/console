'use client'

/**
 * A key cap — the ONE way the console prints a keyboard key. `Kbd` is one glyph;
 * `Keys` renders a whole hotkey string (`'mod+k'` → ⌘ K, `'g h'` → G H) as caps.
 */
import { useEffect, useState } from 'react'
import { Text, XStack } from '@hanzo/gui'

import { glyphsFor } from '~/lib/hotkeys'

export function Kbd({ children }: { children: string }) {
  return (
    <Text
      className="hz-mono"
      fontSize="$1"
      color="$color11"
      bg="$color2"
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$2"
      px="$1.5"
      py="$0.5"
      minW={22}
      style={{ textAlign: 'center' }}
    >
      {children}
    </Text>
  )
}

/**
 * The caps for a hotkey string. `mod` prints ⌘ on a Mac and Ctrl elsewhere —
 * resolved after mount so the server and the first client render agree.
 */
export function Keys({ keys }: { keys: string }) {
  const [mac, setMac] = useState(false)
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
  }, [])
  return (
    <XStack gap="$1" items="center">
      {glyphsFor(keys, mac).map((g, i) => (
        <Kbd key={`${g}-${i}`}>{g}</Kbd>
      ))}
    </XStack>
  )
}
