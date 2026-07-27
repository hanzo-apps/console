'use client'

/**
 * The type-preserving key/value metadata editor — shared by the Catalog and Plans
 * admin editors (both drive a structured `Metadata` envelope over the same commerce
 * pattern). One editor, one place (DRY): a row is `{ key, value }`; the caller's
 * `catalog/logic` serialize/parse keeps each value's real JSON type across the
 * round-trip, so a number stays a number, an array stays an array, and a nested
 * object stays an object.
 */
import { Button, XStack, YStack } from '@hanzo/gui'
import { Plus, Trash2 } from '@hanzogui/lucide-icons-2'

import { FieldText } from '@hanzo/ui/product'
import { type MetadataRow } from '~/components/products/catalog/logic'

export function MetadataEditor({ rows, onChange }: { rows: MetadataRow[]; onChange: (rows: MetadataRow[]) => void }) {
  const setRow = (i: number, patch: Partial<MetadataRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i))
  const addRow = () => onChange([...rows, { key: '', value: '' }])

  return (
    <YStack gap="$2">
      {rows.map((row, i) => (
        <XStack key={i} gap="$2" items="flex-start" flexWrap="wrap">
          <YStack width="100%" $md={{ width: 160 }}>
            <FieldText value={row.key} onChange={(v) => setRow(i, { key: v })} placeholder="key" />
          </YStack>
          <YStack flex={1} minW={0} $md={{ minW: 200 }}>
            <FieldText value={row.value} onChange={(v) => setRow(i, { value: v })} placeholder="value" />
          </YStack>
          <Button
            size="$2"
            chromeless
            icon={<Trash2 size={14} />}
            onPress={() => removeRow(i)}
            aria-label={`Remove ${row.key || 'field'}`}
          />
        </XStack>
      ))}
      <Button size="$2" chromeless icon={<Plus size={14} />} onPress={addRow} self="flex-start">
        Add field
      </Button>
    </YStack>
  )
}
