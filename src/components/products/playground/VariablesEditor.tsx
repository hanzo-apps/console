'use client'

/**
 * VariablesEditor — fill the `{{name}}` variables referenced anywhere in the
 * composer. Names are discovered live from the system + messages; substitution
 * happens at Run time. When there are none, it explains how to add one rather than
 * showing an empty box.
 */
import { Input, Text, XStack, YStack } from '@hanzo/gui'

export function VariablesEditor({
  names,
  values,
  onChange,
}: {
  names: string[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  if (names.length === 0) {
    return (
      <YStack gap="$1" maxW={280} p="$1">
        <Text fontSize="$3" color="$color12" fontWeight="700">
          No variables yet
        </Text>
        <Text fontSize="$2" color="$color10">
          Write <Text style={{ fontFamily: 'monospace' }} color="$color11">{'{{name}}'}</Text> in the system prompt or a message, then
          fill it here. The value is substituted when you Run.
        </Text>
      </YStack>
    )
  }
  return (
    <YStack gap="$2.5" minW={260} p="$1">
      <Text fontSize="$2" color="$color10" letterSpacing={0.5}>
        VARIABLES
      </Text>
      {names.map((name) => (
        <YStack key={name} gap="$1">
          <XStack items="center" gap="$1.5">
            <Text style={{ fontFamily: 'monospace' }} fontSize="$2" color="$color11">
              {`{{${name}}}`}
            </Text>
          </XStack>
          <Input
            size="$3"
            value={values[name] ?? ''}
            onChangeText={(v) => onChange(name, v)}
            placeholder={`value for ${name}`}
            autoCapitalize="none"
          />
        </YStack>
      ))}
    </YStack>
  )
}
