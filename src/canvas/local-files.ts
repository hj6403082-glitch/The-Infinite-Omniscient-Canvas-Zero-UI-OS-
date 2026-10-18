import type { FileMetadata } from '../tools/file-index.ts'
import { MAX_INDEXED_FILES } from '../worker/protocol.ts'

const OCTET_STREAM = 'application/octet-stream'

// Only types the browser renders without running script. Everything else (HTML, SVG, XML,
// scripts, unknown) downloads as opaque bytes: a blob: URL would otherwise run in our origin.
const VIEWABLE: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/plain',
  log: 'text/plain',
  json: 'text/plain',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

export function safeBlobType(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (VIEWABLE[name.slice(dot + 1).toLowerCase()] ?? OCTET_STREAM) : OCTET_STREAM
}

const pathOf = (file: File) => file.webkitRelativePath || file.name
const isHidden = (path: string) => path.split('/').some((segment) => segment.startsWith('.'))
const clip = (value: string, max: number) => (value.length <= max ? value : value.slice(value.length - max))

// Main-thread side of "Connect folder": keeps the File objects, hands the worker metadata only.
export function createLocalFileStore() {
  let files = new Map<string, File>()
  return {
    connect(selection: Iterable<File>): { source: string; files: FileMetadata[] } | null {
      const visible = [...selection].filter((file) => !isHidden(pathOf(file))).slice(0, MAX_INDEXED_FILES)
      if (visible.length === 0) return null
      const first = pathOf(visible[0])
      const source = clip(first.includes('/') ? first.split('/')[0] : 'Selected files', 128)
      files = new Map(visible.map((file, index) => [`u${index + 1}`, file]))
      return {
        source,
        files: [...files].map(([id, file]) => ({
          id,
          name: file.name.slice(0, 255),
          path: clip(pathOf(file), 1024),
          size: file.size,
          modified: Math.max(0, Math.trunc(file.lastModified)),
        })),
      }
    },
    get(id: string): File | undefined {
      return files.get(id)
    },
  }
}

export type LocalFileStore = ReturnType<typeof createLocalFileStore>

export interface OpenEnvironment {
  open(url: string, target: string, features: string): unknown
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
  createAnchor(): { href: string; download: string; rel: string; click(): void }
  setTimeout(callback: () => void, ms: number): unknown
}

const browserEnvironment = (): OpenEnvironment => ({
  open: (url, target, features) => window.open(url, target, features),
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createAnchor: () => document.createElement('a'),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
})

const REVOKE_AFTER_MS = 60_000

export function openLocalFile(file: File, env: OpenEnvironment = browserEnvironment()): 'opened' | 'downloaded' {
  const type = safeBlobType(file.name)
  const url = env.createObjectURL(new Blob([file], { type }))
  env.setTimeout(() => env.revokeObjectURL(url), REVOKE_AFTER_MS)
  if (type !== OCTET_STREAM) {
    env.open(url, '_blank', 'noopener,noreferrer')
    return 'opened'
  }
  const anchor = env.createAnchor()
  anchor.href = url
  anchor.download = file.name
  anchor.rel = 'noopener'
  anchor.click()
  return 'downloaded'
}
