'use client'

/**
 * MediaGrid — the presentational DAM gallery for a media DocType (an Attach-backed
 * collection). Pure view: it takes the already-loaded documents + schema and
 * renders asset cards (thumbnail from the primary Attach field). `DocTypeRecords`
 * renders this instead of the table when `isMediaDoctype(dt)` — so media is just a
 * DocType with a nicer default view, no separate data path and no bespoke subsystem.
 *
 * Assets are per-org: the Attach holds an object URL under the org's own S3 /
 * SeaweedFS prefix. Honest empty state; never a fabricated tile.
 */
import type { ReactNode } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'
import { Image as ImageIcon, Plus } from '@hanzogui/lucide-icons-2'

import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { EmptyState } from '~/components/ui/EmptyState'
import type { DocType, FrameworkDoc } from '~/lib/framework/types'
import { mediaFileField, titleOf } from '~/lib/framework/fields'

export interface MediaGridProps {
  dt: DocType
  docs: FrameworkDoc[]
  onOpen: (name: string) => void
  onCreate: () => void
  toolbarExtra?: ReactNode
}

const looksLikeImage = (url: string): boolean =>
  /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(url) || url.startsWith('data:image/')

export function MediaGrid({ dt, docs, onOpen, onCreate, toolbarExtra }: MediaGridProps) {
  const fileField = mediaFileField(dt)
  if (docs.length === 0) {
    return (
      <YStack gap="$3">
        <XStack justify="flex-end" gap="$2">{toolbarExtra}</XStack>
        <EmptyState
          icon={ImageIcon}
          title="No media yet"
          description="Add an image or file by URL (from your object storage). It becomes a Media document you can reference from any page or post."
          primary={{ label: 'Add media', onPress: onCreate }}
        />
      </YStack>
    )
  }
  return (
    <YStack gap="$3">
      <XStack justify="flex-end" gap="$2" items="center">
        {toolbarExtra}
        <PrimaryButton size="$2" icon={<Plus size={15} />} onPress={onCreate}>Add media</PrimaryButton>
      </XStack>
      <XStack gap="$3" flexWrap="wrap">
        {docs.map((d) => {
          const url = String(d[fileField] ?? '')
          const title = titleOf(d, dt)
          return (
            <YStack
              key={d.name}
              onPress={() => onOpen(String(d.name))}
              cursor="pointer"
              hoverStyle={{ borderColor: '$color8' }}
              borderWidth={1}
              borderColor="$borderColor"
              rounded="$4"
              width={200}
              overflow="hidden"
            >
              <YStack height={130} bg="$color3" items="center" justify="center" overflow="hidden">
                {url && looksLikeImage(url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <ImageIcon size={28} />
                )}
              </YStack>
              <YStack p="$3" gap="$1">
                <Text fontSize="$3" fontWeight="700" numberOfLines={1}>{title}</Text>
                <Text fontSize="$1" color="$color10" numberOfLines={1}>{String(d.mime ?? (url || 'file'))}</Text>
              </YStack>
            </YStack>
          )
        })}
      </XStack>
    </YStack>
  )
}

export default MediaGrid
