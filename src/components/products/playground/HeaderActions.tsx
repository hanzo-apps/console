'use client'

/**
 * HeaderActions — Save prompt / "</>" (code) / Share, acting on the SAME composer
 * state the body edits (no drift). All three are real and local — no backend:
 *   - Save prompt → persists the composer to the local prompt library (shown in
 *     the Examples card), with a name.
 *   - Code        → the real cURL / JSON request for what would be sent.
 *   - Share       → writes the composer into the URL (`?p=`) and copies the link;
 *     opening it restores the exact prompt, model and settings.
 */
import { useState } from 'react'
import { Button, Input, Popover, Text, XStack, YStack } from '@hanzo/gui'
import { Bookmark, Code2, Share2, Check } from '@hanzogui/lucide-icons-2'

import { RequestPreview } from './RequestPreview'
import { encodeShare, SHARE_PARAM } from './share'
import { saveSaved, type SavedPrompt } from './prompts'
import type { Composer } from './useComposer'
import { paper } from '~/components/ui/paper'

export function HeaderActions({
  composer,
  mode,
  curl,
  json,
  onSaved,
}: {
  composer: Composer
  mode: 'chat' | 'completions'
  curl: string
  json: string
  onSaved: (list: SavedPrompt[]) => void
}) {
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)

  const firstUser = composer.messages.find((m) => m.role === 'user')?.content ?? ''
  const defaultName = (firstUser.trim() || 'Untitled prompt').slice(0, 48)

  const doSave = () => {
    const entry: SavedPrompt = {
      id: `sp_${Date.now().toString(36)}`,
      name: (name.trim() || defaultName).slice(0, 64),
      model: composer.model,
      system: composer.system,
      user: firstUser,
      at: Date.now(),
    }
    onSaved(saveSaved(entry))
    setName('')
    setSaveOpen(false)
  }

  const doShare = () => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set(SHARE_PARAM, encodeShare(composer.snapshot(mode)))
    window.history.replaceState(null, '', url.toString())
    if (navigator.clipboard) navigator.clipboard.writeText(url.toString()).catch(() => {})
    setShared(true)
    setTimeout(() => setShared(false), 1400)
  }

  return (
    <XStack gap="$2" items="center">
      {/* Save prompt */}
      <Popover open={saveOpen} onOpenChange={setSaveOpen} placement="bottom-end">
        <Popover.Trigger asChild>
          <Button size="$2" icon={<Bookmark size={14} />} borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$2" color="$color11">
              Save prompt
            </Text>
          </Button>
        </Popover.Trigger>
        <Popover.Content {...paper} p="$3" minW={280}>
          <YStack gap="$2" minW={260}>
            <Text fontSize="$3" fontWeight="700">
              Save prompt
            </Text>
            <Input
              size="$3"
              value={name}
              onChangeText={setName}
              placeholder={defaultName}
              autoCapitalize="none"
            />
            <XStack justify="flex-end" gap="$2">
              <Button size="$2" chromeless onPress={() => setSaveOpen(false)}>
                Cancel
              </Button>
              <Button size="$2" bg="$color12" icon={<Bookmark size={13} color="$color1" />} onPress={doSave}>
                <Text fontSize="$2" color="$color1" fontWeight="600">
                  Save
                </Text>
              </Button>
            </XStack>
          </YStack>
        </Popover.Content>
      </Popover>

      {/* Code (request preview) */}
      <Popover placement="bottom-end">
        <Popover.Trigger asChild>
          <Button size="$2" icon={<Code2 size={15} />} borderWidth={1} borderColor="$borderColor" />
        </Popover.Trigger>
        <Popover.Content {...paper} p="$3">
          <RequestPreview curl={curl} json={json} />
        </Popover.Content>
      </Popover>

      {/* Share */}
      <Button
        size="$2"
        icon={shared ? <Check size={14} color="$green10" /> : <Share2 size={14} />}
        borderWidth={1}
        borderColor="$borderColor"
        onPress={doShare}
      >
        <Text fontSize="$2" color="$color11">
          {shared ? 'Link copied' : 'Share'}
        </Text>
      </Button>
    </XStack>
  )
}
