'use client'

/**
 * MessageCard — one editable message in the composer (the System prompt card and
 * each user/assistant turn). Header: a role label (a chip that toggles user↔
 * assistant when `onToggleRole` is given) and a live "len / max" character count
 * that turns red past the cap; an optional remove. Body: the editable text. The
 * cap is a soft display limit — typing is never truncated, the count just warns.
 */
import { Button, Card, TextArea, Text, XStack } from '@hanzo/gui'
import { X } from '@hanzogui/lucide-icons-2'

export function MessageCard({
  label,
  content,
  onChange,
  max,
  placeholder,
  rows = 4,
  disabled,
  onToggleRole,
  onRemove,
}: {
  label: string
  content: string
  onChange: (v: string) => void
  max: number
  placeholder?: string
  rows?: number
  disabled?: boolean
  onToggleRole?: () => void
  onRemove?: () => void
}) {
  const over = content.length > max
  return (
    <Card p="$3" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color1">
      <XStack items="center" justify="space-between" gap="$2">
        {onToggleRole ? (
          <Button
            size="$1"
            chromeless
            bg="$color3"
            px="$2"
            rounded="$10"
            disabled={disabled}
            onPress={onToggleRole}
          >
            <Text fontSize="$1" color="$color11" fontWeight="600">
              {label}
            </Text>
          </Button>
        ) : (
          <Text fontSize="$2" color="$color11" fontWeight="700">
            {label}
          </Text>
        )}
        <XStack items="center" gap="$2">
          <Text fontSize="$1" color={over ? '$red10' : '$color9'}>
            {content.length} / {max}
          </Text>
          {onRemove ? (
            <Button size="$1" chromeless icon={<X size={13} />} disabled={disabled} onPress={onRemove} />
          ) : null}
        </XStack>
      </XStack>
      <TextArea
        value={content}
        onChangeText={onChange}
        disabled={disabled}
        numberOfLines={rows}
        placeholder={placeholder}
        borderWidth={0}
        bg="transparent"
        p="$0"
      />
    </Card>
  )
}
