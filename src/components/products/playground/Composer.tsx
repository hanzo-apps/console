'use client'

/**
 * Composer — the left/center column: a model chip (with copy + clear), the System
 * prompt card and the ordered user/assistant turns, then a footer of "+ Add
 * message", Upload (attach an image for vision), "{} Variables", and the primary
 * Run button (⌘↵ + a quick-actions caret). In Completions mode it collapses to a
 * single raw Prompt card. All state comes from `useComposer`; running is the
 * parent's job.
 */
import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { Button, Card, Popover, Text, XStack, YStack } from '@hanzo/gui'
import { Copy, Trash2, Plus, Upload, Braces, Play, Square, ChevronDown, X } from '@hanzogui/lucide-icons-2'

import { MessageCard } from './MessageCard'
import { ModelPicker } from './ModelPicker'
import { VariablesEditor } from './VariablesEditor'
import type { Composer as ComposerState } from './useComposer'
import type { ModelOption } from './useModels'

const SYSTEM_MAX = 2048
const USER_MAX = 16384

function roleLabel(role: 'user' | 'assistant'): string {
  return role === 'user' ? 'User' : 'Assistant'
}

function copyText(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {})
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
}: {
  composer: ComposerState
  mode: 'chat' | 'completions'
  models: ModelOption[]
  modelsLoading: boolean
  running: boolean
  onRun: () => void
  onStop: () => void
  curl: string
  json: string
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      const reader = new FileReader()
      reader.onload = () => composer.setAttachment({ name: f.name, dataUrl: String(reader.result) })
      reader.readAsDataURL(f)
    }
    e.target.value = ''
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color1">
      {/* Model chip row */}
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <ModelPicker
          value={composer.model}
          options={models}
          onChange={composer.setModel}
          disabled={running || modelsLoading}
        />
        <XStack items="center" gap="$0.5">
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

      {/* Attachment chip */}
      {composer.attachment ? (
        <XStack
          self="flex-start"
          items="center"
          gap="$2"
          px="$2.5"
          py="$1.5"
          rounded="$3"
          bg="$color2"
          borderWidth={1}
          borderColor="$borderColor"
        >
          <Upload size={13} color="$color10" />
          <Text fontSize="$1" color="$color11" numberOfLines={1} maxW={200}>
            {composer.attachment.name}
          </Text>
          <Button size="$1" chromeless icon={<X size={12} />} onPress={() => composer.setAttachment(null)} />
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
            <Popover.Content bordered elevate p="$3" bg="$color2" borderColor="$borderColor">
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
            <Popover.Content bordered elevate p="$1.5" bg="$color2" borderColor="$borderColor" minW={200}>
              <YStack gap="$0.5" minW={200}>
                <MenuRow label="Copy request as cURL" onPress={() => copyText(curl)} />
                <MenuRow label="Copy request as JSON" onPress={() => copyText(json)} />
              </YStack>
            </Popover.Content>
          </Popover>
        </XStack>
      </XStack>

      {/* Hidden file input for Upload (image → vision content part on Run). */}
      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
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
