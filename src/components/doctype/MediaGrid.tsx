'use client'

/**
 * MediaGrid — the DAM (media library) for a media DocType (an Attach-backed
 * collection). A REAL asset manager: drag/drop or pick files → they upload to the
 * org's own S3 (`cms-media` bucket, via `media-upload.ts` over the same /v1/s3
 * SeaweedFS the Storage product uses) → a Media document is created with the stable
 * object key → the grid shows a live thumbnail (presigned-on-view, since object
 * URLs are short-lived). Delete removes the document AND the S3 object.
 *
 * Media is per-org by construction (the S3 namespace + the framework docs both
 * resolve the org from the bearer). Honest empty state; a non-image asset shows a
 * file glyph, never a broken image. `DocTypeRecords` renders this for a media
 * collection (`isMediaDoctype(dt)`) — media is just a DocType with a nicer view.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Image as ImageIcon, Trash2, TriangleAlert, Upload } from '@hanzogui/lucide-icons-2'

import type { FrameworkClient } from '~/lib/framework/client'
import type { DocType, FrameworkDoc } from '~/lib/framework/types'
import { mediaFileField, titleOf } from '~/lib/framework/fields'
import { uploadMedia, resolveMediaUrl, deleteMediaObject } from './media-upload'
import { EmptyState, PrimaryButton, classifyBackend } from '@hanzo/ui/product'

export interface MediaGridProps {
  client: FrameworkClient
  dt: DocType
  docs: FrameworkDoc[]
  /** Open a media document's detail (edit alt text, replace, etc.). */
  onOpen: (name: string) => void
  /** Re-fetch the media list after an upload/delete. */
  onChanged: () => void
  toolbarExtra?: ReactNode
}

const looksLikeImage = (url: string): boolean =>
  /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(url) || url.startsWith('data:image/') || url.includes('/objects/')

export function MediaGrid({ client, dt, docs, onOpen, onChanged, toolbarExtra }: MediaGridProps) {
  const fileField = mediaFileField(dt)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      setBusy(true)
      setError(null)
      setProgress({ done: 0, total: list.length })
      try {
        for (let i = 0; i < list.length; i += 1) {
          const f = list[i]
          const up = await uploadMedia(f)
          await client.records.create(dt.name, {
            title: f.name,
            [fileField]: up.fileRef,
            mime: up.mime,
            size: up.size,
            width: up.width,
            height: up.height,
          })
          setProgress({ done: i + 1, total: list.length })
        }
        onChanged()
      } catch (e) {
        setError(classifyBackend(e).message)
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },
    [client, dt.name, fileField, onChanged],
  )

  const pick = () => inputRef.current?.click()
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void upload(e.target.files)
    e.target.value = '' // allow re-selecting the same file
  }

  const HiddenInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept="image/*,application/pdf,video/*,audio/*"
      style={{ display: 'none' }}
      onChange={onInput}
    />
  )

  const uploadLabel = busy
    ? progress ? `Uploading ${progress.done}/${progress.total}…` : 'Uploading…'
    : 'Upload'

  if (docs.length === 0) {
    return (
      <YStack gap="$3">
        {HiddenInput}
        <XStack justify="flex-end" gap="$2">{toolbarExtra}</XStack>
        {error ? <ErrorBar message={error} /> : null}
        <DropZone busy={busy} onDrop={upload}>
          <EmptyState
            icon={ImageIcon}
            title="No media yet"
            description="Drag files here, or upload — images and files go to your organization's object storage and become reusable Media you can attach to any page or post."
            primary={{ label: uploadLabel, onPress: pick }}
          />
        </DropZone>
      </YStack>
    )
  }

  return (
    <YStack gap="$3">
      {HiddenInput}
      <XStack justify="flex-end" gap="$2" items="center">
        {toolbarExtra}
        <PrimaryButton size="$2" icon={<Upload size={15} />} disabled={busy} onPress={pick}>{uploadLabel}</PrimaryButton>
      </XStack>
      {error ? <ErrorBar message={error} /> : null}
      <DropZone busy={busy} onDrop={upload}>
        <XStack gap="$3" flexWrap="wrap">
          {docs.map((d) => (
            <MediaCard
              key={String(d.name)}
              doc={d}
              dt={dt}
              fileField={fileField}
              onOpen={() => onOpen(String(d.name))}
              onDelete={async () => {
                setBusy(true)
                setError(null)
                try {
                  await deleteMediaObject(d[fileField])
                  await client.records.remove(dt.name, String(d.name))
                  onChanged()
                } catch (e) {
                  setError(classifyBackend(e).message)
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
            />
          ))}
        </XStack>
      </DropZone>
    </YStack>
  )
}

/** One asset card — presigned thumbnail, title, type, and a delete affordance. */
function MediaCard({
  doc, dt, fileField, onOpen, onDelete, disabled,
}: {
  doc: FrameworkDoc
  dt: DocType
  fileField: string
  onOpen: () => void
  onDelete: () => void | Promise<void>
  disabled?: boolean
}) {
  const [url, setUrl] = useState('')
  const [confirming, setConfirming] = useState(false)
  const raw = String(doc[fileField] ?? '')
  const title = titleOf(doc, dt)

  useEffect(() => {
    let cancelled = false
    void resolveMediaUrl(raw).then((u) => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [raw])

  return (
    <YStack
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$4"
      width={200}
      overflow="hidden"
      hoverStyle={{ borderColor: '$color8' }}
    >
      <YStack height={130} bg="$color3" items="center" justify="center" overflow="hidden" cursor="pointer" onPress={onOpen}>
        {url && looksLikeImage(raw || url) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={String(doc.alt ?? title)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <ImageIcon size={28} />
        )}
      </YStack>
      <YStack p="$3" gap="$1">
        <Text fontSize="$3" fontWeight="700" numberOfLines={1}>{title}</Text>
        <XStack justify="space-between" items="center">
          <Text fontSize="$1" color="$color10" numberOfLines={1}>{String(doc.mime ?? 'file')}</Text>
          {confirming ? (
            <XStack gap="$1">
              <Button size="$1" theme="red" disabled={disabled} onPress={() => { setConfirming(false); void onDelete() }}>Delete file</Button>
              <Button size="$1" disabled={disabled} onPress={() => setConfirming(false)}>Keep</Button>
            </XStack>
          ) : (
            <Button size="$1" circular chromeless icon={<Trash2 size={13} />} disabled={disabled} onPress={() => setConfirming(true)} />
          )}
        </XStack>
      </YStack>
    </YStack>
  )
}

/** A drag-and-drop wrapper that highlights on drag-over and uploads on drop. */
function DropZone({ children, busy, onDrop }: { children: ReactNode; busy?: boolean; onDrop: (files: FileList) => void | Promise<void> }) {
  const [over, setOver] = useState(false)
  return (
    <YStack
      onDragOver={(e: React.DragEvent) => { e.preventDefault(); if (!busy) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: React.DragEvent) => {
        e.preventDefault()
        setOver(false)
        if (!busy && e.dataTransfer?.files?.length) void onDrop(e.dataTransfer.files)
      }}
      rounded="$4"
      p={over ? '$3' : 0}
      borderWidth={over ? 2 : 0}
      borderColor="$color8"
      style={{ borderStyle: 'dashed', transition: 'padding 0.1s ease' }}
    >
      {children}
    </YStack>
  )
}

function ErrorBar({ message }: { message: string }) {
  return (
    <Card borderWidth={1} borderColor="$red7" bg="$red2" p="$3" maxWidth={620}>
      <XStack gap="$2" items="center"><TriangleAlert size={15} /><Text fontSize="$3" color="$red11">{message}</Text></XStack>
    </Card>
  )
}

