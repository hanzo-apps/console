/**
 * Drag-drop / file-input reader for the deploy zone (browser-only). Turns a drop or a
 * `<input>` selection into ONE of:
 *   - `{ archive, contentType }` — a single `.zip`/`.tar.gz` the caller uploads verbatim;
 *   - `{ files }` — a folder's files (relative paths), which the caller packs to tar.gz;
 *   - `{ error }` — nothing usable (empty, or an unsupported single file).
 *
 * The pure archive/tar packing lives in `archive.ts`; this module is only the browser
 * plumbing (File bytes, `webkitGetAsEntry` directory walk, `webkitRelativePath`).
 */
import type { ArtifactFile } from './archive'
import { artifactContentType } from '~/components/products/platform-hub/logic'

export type DropResult =
  | { kind: 'archive'; archive: Uint8Array; contentType: string; label: string }
  | { kind: 'folder'; files: ArtifactFile[]; label: string }
  | { kind: 'error'; error: string }

const bytesOf = async (f: File): Promise<Uint8Array> => new Uint8Array(await f.arrayBuffer())

/** Minimal structural type for a webkit filesystem entry (not in lib.dom for all TS targets). */
type DirReader = { readEntries: (cb: (entries: FsEntry[]) => void, err?: (e: unknown) => void) => void }
type FsEntry = {
  isFile: boolean
  isDirectory: boolean
  fullPath: string
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void
  createReader?: () => DirReader
}

const entryFile = (entry: FsEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file?.(resolve, reject))

/** Read every child entry of a directory (readEntries returns in batches until empty). */
function readDirEntries(reader: DirReader): Promise<FsEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FsEntry[] = []
    const step = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all)
        all.push(...batch)
        step()
      }, reject)
    step()
  })
}

/** Recursively collect every file under `entry` as an ArtifactFile (path = fullPath). */
async function walkEntry(entry: FsEntry, out: ArtifactFile[]): Promise<void> {
  if (entry.isFile) {
    const f = await entryFile(entry)
    out.push({ path: entry.fullPath.replace(/^\/+/, ''), data: await bytesOf(f) })
    return
  }
  if (entry.isDirectory && entry.createReader) {
    const children = await readDirEntries(entry.createReader())
    for (const child of children) await walkEntry(child, out)
  }
}

/** Read a drag-drop `DataTransfer` into a DropResult. */
export async function readDrop(dt: DataTransfer): Promise<DropResult> {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === 'file')
  // Prefer the entry API (the only way to see a dropped FOLDER's contents).
  const entries = items
    .map((i) => (i as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() ?? null)
    .filter((e): e is FsEntry => e != null)

  if (entries.length === 1 && entries[0].isFile) {
    const f = await entryFile(entries[0])
    return fileToResult(f)
  }
  if (entries.some((e) => e.isDirectory)) {
    const files: ArtifactFile[] = []
    for (const e of entries) await walkEntry(e, files)
    if (!files.length) return { kind: 'error', error: 'The dropped folder is empty.' }
    return { kind: 'folder', files, label: `${files.length} files` }
  }

  // Fallback: no entry API — treat a single dropped File as an archive.
  const files = Array.from(dt.files ?? [])
  if (files.length === 1) return fileToResult(files[0])
  if (files.length > 1) return { kind: 'error', error: 'Drop ONE .zip/.tar.gz, or a folder.' }
  return { kind: 'error', error: 'Nothing to deploy.' }
}

/** Read a `<input type=file>` (archive) or `<input webkitdirectory>` (folder) selection. */
export async function readInputFiles(fileList: FileList | null): Promise<DropResult> {
  const files = Array.from(fileList ?? [])
  if (!files.length) return { kind: 'error', error: 'No file selected.' }
  // A directory input tags each file with a webkitRelativePath ("dist/index.html").
  const asFolder = files.filter((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath)
  if (asFolder.length) {
    const packed: ArtifactFile[] = []
    for (const f of asFolder) {
      packed.push({ path: (f as File & { webkitRelativePath: string }).webkitRelativePath, data: await bytesOf(f) })
    }
    return { kind: 'folder', files: packed, label: `${packed.length} files` }
  }
  if (files.length === 1) return fileToResult(files[0])
  return { kind: 'error', error: 'Select ONE .zip/.tar.gz, or use “Upload a folder”.' }
}

/** Classify a single File as a supported archive, else an honest error. */
async function fileToResult(f: File): Promise<DropResult> {
  const contentType = artifactContentType(f.name)
  if (!contentType) {
    return { kind: 'error', error: `Unsupported file "${f.name}". Upload a .zip or .tar.gz of the built site, or a folder.` }
  }
  return { kind: 'archive', archive: await bytesOf(f), contentType, label: f.name }
}
