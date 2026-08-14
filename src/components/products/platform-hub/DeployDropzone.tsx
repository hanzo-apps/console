'use client'

/**
 * Deploy drop zone — drag-and-drop (or pick) a `.zip`/`.tar.gz` BUILT static site, OR a
 * FOLDER that is packed to a tar.gz in the browser. Hands the raw artifact bytes +
 * Content-Type to `onDeploy`; the parent POSTs them to `/v1/platform/sites/:slug/deploy`.
 * Honest by construction: an unsupported file / empty folder shows a reason, never a
 * silent no-op; a browser without `CompressionStream` says so instead of failing opaquely.
 */
import { useRef, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { FileArchive, FolderUp, TriangleAlert, UploadCloud } from '@hanzogui/lucide-icons-2'

import { ARTIFACT_GZIP } from '~/lib/api/platform-sites'
import { filesToTarGz, gzipSupported } from '~/lib/deploy/archive'
import { readDrop, readInputFiles, type DropResult } from '~/lib/deploy/drop'
import { PrimaryButton } from '@hanzo/ui/product'

export function DeployDropzone({
  busy,
  onDeploy,
}: {
  busy: boolean
  /** Upload the built artifact. `label` names what was deployed (filename / "N files"). */
  onDeploy: (artifact: Uint8Array, contentType: string, label: string) => void | Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const dirRef = useRef<HTMLInputElement | null>(null)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [packing, setPacking] = useState(false)

  const working = busy || packing

  const handle = async (result: DropResult) => {
    setError(null)
    if (result.kind === 'error') {
      setError(result.error)
      return
    }
    if (result.kind === 'archive') {
      await onDeploy(result.archive, result.contentType, result.label)
      return
    }
    // A folder → pack to tar.gz in the browser, then upload.
    if (!gzipSupported()) {
      setError('This browser can’t pack a folder. Upload a .zip or .tar.gz of the built site instead.')
      return
    }
    setPacking(true)
    try {
      const bytes = await filesToTarGz(result.files)
      await onDeploy(bytes, ARTIFACT_GZIP, result.label)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The folder could not be packed, so nothing was uploaded. Choose a .zip or .tar.gz of the built site instead.')
    } finally {
      setPacking(false)
    }
  }

  return (
    <YStack gap="$3" maxW={720}>
      <YStack
        onDragOver={(e: React.DragEvent) => {
          e.preventDefault()
          if (!working) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: React.DragEvent) => {
          e.preventDefault()
          setOver(false)
          // readDrop needs the whole DataTransfer (folder entries live in `.items`,
          // not `.files`), so pass the event's transfer, not a flattened FileList.
          if (!working && e.dataTransfer) void readDrop(e.dataTransfer).then(handle)
        }}
        items="center"
        justify="center"
        gap="$3"
        p="$6"
        rounded="$5"
        borderWidth={2}
        borderColor={over ? '$color9' : '$borderColor'}
        bg={over ? '$color3' : '$color1'}
        style={{ borderStyle: 'dashed', transition: 'background 0.12s ease, border-color 0.12s ease' }}
      >
        <YStack width={48} height={48} items="center" justify="center" rounded="$4" bg="$color3">
          <UploadCloud size={24} opacity={working ? 0.5 : 0.9} />
        </YStack>
        <YStack gap="$1" items="center" maxW={460}>
          <Text fontSize="$5" fontWeight="600" text="center">
            {packing ? 'Packing folder…' : busy ? 'Deploying…' : 'Drag & drop your build to deploy'}
          </Text>
          <Text fontSize="$3" color="$color11" text="center">
            Drop a <Text fontWeight="600">.zip</Text> or <Text fontWeight="600">.tar.gz</Text> of the built site
            (an <Text fontWeight="600">index.html</Text> at its root), or a folder — it’s packed and uploaded here.
          </Text>
        </YStack>
        <XStack gap="$2" flexWrap="wrap" justify="center">
          <PrimaryButton size="$3" icon={<FileArchive size={15} />} disabled={working} onPress={() => fileRef.current?.click()}>
            Choose archive
          </PrimaryButton>
          <Button size="$3" icon={<FolderUp size={15} />} disabled={working} onPress={() => dirRef.current?.click()}>
            Upload a folder
          </Button>
        </XStack>
      </YStack>

      {error ? (
        <Card borderWidth={1} borderColor="$red7" bg="$red2" p="$3" maxWidth={720}>
          <XStack gap="$2" items="center">
            <TriangleAlert size={15} />
            <Text fontSize="$3" color="$red11">
              {error}
            </Text>
          </XStack>
        </Card>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept=".zip,.tar.gz,.tgz,.gz,application/zip,application/gzip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const fl = e.target.files
          e.target.value = ''
          void readInputFiles(fl).then(handle)
        }}
      />
      <input
        ref={dirRef}
        type="file"
        // @ts-expect-error — non-standard directory-pick attributes (Chromium/WebKit).
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const fl = e.target.files
          e.target.value = ''
          void readInputFiles(fl).then(handle)
        }}
      />
    </YStack>
  )
}
