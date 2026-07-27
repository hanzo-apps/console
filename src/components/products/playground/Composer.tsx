'use client'

/**
 * Composer — the left/center column: a model chip (with copy + clear), the System
 * prompt card and the ordered user/assistant turns, then a footer of "+ Add
 * message", Upload (attach an image for vision), "{} Variables", and the primary
 * Run button (⌘↵ + a quick-actions caret). In Completions mode it collapses to a
 * single raw Prompt card. All state comes from `useComposer`; running is the
 * parent's job.
 */
import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { Button, Card, Image, Popover, Text, XStack, YStack } from '@hanzo/gui'
import { Copy, Trash2, Plus, Upload, Braces, Play, Square, ChevronDown, X, SlidersHorizontal, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { MessageCard } from './MessageCard'
import { ModelSelector } from '~/components/products/ModelSelector'
import { VariablesEditor } from './VariablesEditor'
import type { Composer as ComposerState } from './useComposer'
import type { CatalogEntry } from '~/lib/api/aicatalog'
import { paper } from '~/components/ui/paper'

const SYSTEM_MAX = 2048
const USER_MAX = 16384

function roleLabel(role: 'user' | 'assistant'): string {
  return role === 'user' ? 'User' : 'Assistant'
}

function copyText(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {})
}

/** Read every image File to a data URL (in parallel), skipping non-images. */
function readImages(files: File[]): Promise<{ name: string; dataUrl: string }[]> {
  return Promise.all(
    files
      .filter((f) => f.type.startsWith('image/'))
      .map(
        (f) =>
          new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve({ name: f.name, dataUrl: String(reader.result) })
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(f)
          }),
      ),
  )
}

export function Composer({
  composer,
  mode,
  models,
  modelsLoading,
  running,
  onRun,
  onStop,
  curl,
  json,
  validation,
  settingsOpen,
  onToggleSettings,
  onOpenSettingsSheet,
}: {
  composer: ComposerState
  mode: 'chat' | 'completions'
  models: CatalogEntry[]
  modelsLoading: boolean
  running: boolean
  onRun: () => void
  onStop: () => void
  curl: string
  json: string
  /** The honest reason Run can't proceed (empty message, no model) — shown PROMINENTLY
   *  right by the Run button so hitting Run is never a silent no-op. */
  validation?: string | null
  /** Whether the desktop settings side-pane is shown (chevron reflects it). */
  settingsOpen: boolean
  /** Toggle the desktop inline settings side-pane. */
  onToggleSettings: () => void
  /** Open the mobile settings bottom sheet. */
  onOpenSettingsSheet: () => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)

  // Pick MULTIPLE images in one dialog → append them all (accumulate across dialogs).
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    void readImages(Array.from(e.target.files ?? [])).then((imgs) => composer.addAttachments(imgs)).catch(() => {})
    e.target.value = ''
  }

  // Drag-drop of one or several images onto the composer → append them all.
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (running) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length) void readImages(files).then((imgs) => composer.addAttachments(imgs)).catch(() => {})
  }
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (running) return
    e.preventDefault()
    if (!dragging) setDragging(true)
  }

  return (
    <Card
      p="$4"
      gap="$3"
      borderWidth={1}
      borderColor={dragging ? '$color8' : '$borderColor'}
      bg="$color1"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
    >
      {/* Model chip row */}
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <ModelSelector
          models={models}
          value={composer.model}
          onChange={composer.setModel}
          disabled={running || modelsLoading}
        />
        <XStack items="center" gap="$0.5">
          {/* Settings — desktop toggles the attached side-pane; the chevron shows
              its state. (Hidden below md, where the mobile trigger takes over.) */}
          <Button
            size="$2"
            chromeless
            display="none"
            $md={{ display: 'flex' }}
            icon={<SlidersHorizontal size={15} />}
            iconAfter={<ChevronDown size={13} opacity={0.6} rotate={settingsOpen ? '0deg' : '-90deg'} />}
            onPress={onToggleSettings}
            aria-label={settingsOpen ? 'Hide model settings' : 'Show model settings'}
          >
            <Text fontSize="$2" color="$color11">
              Settings
            </Text>
          </Button>
          {/* Settings — mobile opens the bottom sheet. (Hidden at md+.) */}
          <Button
            size="$2"
            chromeless
            $md={{ display: 'none' }}
            icon={<SlidersHorizontal size={16} />}
            onPress={onOpenSettingsSheet}
            aria-label="Model settings"
          />
          <Button
            size="$2"
            chromeless
            icon={<Copy size={15} />}
            disabled={!composer.model}
            onPress={() => copyText(composer.model)}
          />
          <Button size="$2" chromeless icon={<Trash2 size={15} />} disabled={running} onPress={composer.clear} />
        </XStack>
      </XStack>

      {/* Messages */}
      {mode === 'completions' ? (
        <MessageCard
          label="Prompt"
          content={composer.messages[0]?.content ?? ''}
          onChange={(v) => composer.updateMessage(composer.messages[0]?.id ?? '', v)}
          max={USER_MAX}
          rows={10}
          placeholder="Write a prompt to complete…"
          disabled={running}
        />
      ) : (
        <>
          <MessageCard
            label="System prompt"
            content={composer.system}
            onChange={composer.setSystem}
            max={SYSTEM_MAX}
            rows={3}
            placeholder="You are a helpful assistant…"
            disabled={running}
          />
          {composer.messages.map((m) => (
            <MessageCard
              key={m.id}
              label={roleLabel(m.role)}
              content={m.content}
              onChange={(v) => composer.updateMessage(m.id, v)}
              max={USER_MAX}
              rows={4}
              placeholder={m.role === 'user' ? 'Write a message…' : 'Assistant turn (for few-shot examples)…'}
              disabled={running}
              onToggleRole={() => composer.toggleRole(m.id)}
              onRemove={composer.messages.length > 1 ? () => composer.removeMessage(m.id) : undefined}
            />
          ))}
        </>
      )}

      {/* Attached images — a thumbnail strip with a count and a per-image remove (×). */}
      {composer.attachments.length ? (
        <YStack gap="$1.5" self="stretch">
          <Text fontSize="$1" color="$color10">
            {composer.attachments.length} image{composer.attachments.length === 1 ? '' : 's'} attached
          </Text>
          <XStack gap="$2" flexWrap="wrap">
            {composer.attachments.map((a) => (
              <YStack
                key={a.id}
                width={64}
                height={64}
                rounded="$3"
                overflow="hidden"
                borderWidth={1}
                borderColor="$borderColor"
                bg="$color2"
                position="relative"
              >
                <Image source={{ uri: a.dataUrl }} width={64} height={64} resizeMode="cover" alt={a.name} />
                <Button
                  size="$1"
                  circular
                  position="absolute"
                  t={2}
                  r={2}
                  bg="$color1"
                  borderWidth={1}
                  borderColor="$borderColor"
                  icon={<X size={11} />}
                  disabled={running}
                  aria-label={`Remove ${a.name}`}
                  onPress={() => composer.removeAttachment(a.id)}
                />
              </YStack>
            ))}
          </XStack>
        </YStack>
      ) : null}

      {/* The honest block reason — prominent, right above Run, so Run is never a silent no-op. */}
      {validation ? (
        <XStack
          items="center"
          gap="$2"
          px="$3"
          py="$2"
          rounded="$3"
          self="stretch"
          bg="$red2"
          borderWidth={1}
          borderColor="$red6"
        >
          <TriangleAlert size={15} color="$red10" />
          <Text fontSize="$2" fontWeight="600" color="$red11">
            {validation}
          </Text>
        </XStack>
      ) : null}

      {/* Footer */}
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap" pt="$1">
        <XStack items="center" gap="$1.5" flexWrap="wrap">
          {mode === 'chat' ? (
            <Button size="$2" chromeless icon={<Plus size={15} />} disabled={running} onPress={composer.addMessage}>
              <Text fontSize="$2" color="$color11">
                Add message
              </Text>
            </Button>
          ) : null}
          <Button size="$2" chromeless icon={<Upload size={15} />} disabled={running} onPress={() => fileRef.current?.click()}>
            <Text fontSize="$2" color="$color11">
              Upload
            </Text>
          </Button>
          <Popover placement="top-start">
            <Popover.Trigger asChild>
              <Button size="$2" chromeless icon={<Braces size={15} />} disabled={running}>
                <Text fontSize="$2" color="$color11">
                  Variables{composer.varNames.length ? ` (${composer.varNames.length})` : ''}
                </Text>
              </Button>
            </Popover.Trigger>
            <Popover.Content {...paper} p="$3">
              <VariablesEditor names={composer.varNames} values={composer.vars} onChange={composer.setVar} />
            </Popover.Content>
          </Popover>
        </XStack>

        {/* Run + caret */}
        <XStack items="center" gap={1}>
          {running ? (
            <Button size="$3" icon={<Square size={14} />} onPress={onStop} bg="$color5" borderTopRightRadius={0} borderBottomRightRadius={0}>
              Stop
            </Button>
          ) : (
            <Button
              size="$3"
              icon={<Play size={15} color="$color1" />}
              onPress={onRun}
              bg="$color12"
              borderTopRightRadius={0}
              borderBottomRightRadius={0}
            >
              <XStack items="center" gap="$2">
                <Text fontSize="$3" fontWeight="700" color="$color1">
                  Run
                </Text>
                <Text fontSize="$1" color="$color1" opacity={0.7}>
                  ⌘↵
                </Text>
              </XStack>
            </Button>
          )}
          <Popover placement="top-end">
            <Popover.Trigger asChild>
              <Button
                size="$3"
                bg={running ? '$color5' : '$color12'}
                px="$2"
                borderTopLeftRadius={0}
                borderBottomLeftRadius={0}
                icon={<ChevronDown size={15} color={running ? undefined : '$color1'} />}
              />
            </Popover.Trigger>
            <Popover.Content {...paper} p="$1.5" minW={200}>
              <YStack gap="$0.5" minW={200}>
                <MenuRow label="Copy request as cURL" onPress={() => copyText(curl)} />
                <MenuRow label="Copy request as JSON" onPress={() => copyText(json)} />
              </YStack>
            </Popover.Content>
          </Popover>
        </XStack>
      </XStack>

      {/* Hidden file input for Upload — `multiple` so several images pick at once (image
          → vision content part on Run). Drag-drop onto the card also accumulates. */}
      <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFile} style={{ display: 'none' }} />
    </Card>
  )
}

function MenuRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <XStack
      items="center"
      px="$2.5"
      py="$2"
      rounded="$3"
      cursor="pointer"
      hoverStyle={{ bg: '$color4' }}
      onPress={onPress}
    >
      <Text fontSize="$2" color="$color12">
        {label}
      </Text>
    </XStack>
  )
}
