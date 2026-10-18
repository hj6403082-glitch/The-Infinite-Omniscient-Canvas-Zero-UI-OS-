// File index for the searchFiles tool: demo files until the user connects a folder, whose
// metadata (never contents) then replaces them.

export interface FileEntry {
  id: string
  name: string
  kind: string
  modified: string
  size: string
  path?: string
}

// What the main thread sends for each file in a connected folder.
export interface FileMetadata {
  id: string
  name: string
  path: string
  size: number
  modified: number
}

const KINDS: Record<string, string> = {
  pdf: 'PDF document',
  doc: 'Document',
  docx: 'Document',
  odt: 'Document',
  rtf: 'Document',
  xls: 'Spreadsheet',
  xlsx: 'Spreadsheet',
  ods: 'Spreadsheet',
  csv: 'CSV data',
  ppt: 'Presentation',
  pptx: 'Presentation',
  key: 'Presentation',
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  gif: 'Image',
  webp: 'Image',
  avif: 'Image',
  heic: 'Image',
  svg: 'Image',
  mp3: 'Audio',
  wav: 'Audio',
  flac: 'Audio',
  m4a: 'Audio',
  mp4: 'Video',
  mov: 'Video',
  webm: 'Video',
  md: 'Markdown',
  txt: 'Text',
  log: 'Text',
  json: 'JSON data',
  tflite: 'LiteRT model',
  zip: 'Archive',
}

export function kindOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (KINDS[name.slice(dot + 1).toLowerCase()] ?? 'File') : 'File'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

export function toFileEntry({ id, name, path, size, modified }: FileMetadata): FileEntry {
  return { id, name, kind: kindOf(name), modified: new Date(modified).toISOString().slice(0, 10), size: formatBytes(size), path }
}

const raw: [string, string, string, string][] = [
  ['invoice-2026-07.pdf', 'PDF document', '2026-07-31', '182 KB'],
  ['invoice-2026-08.pdf', 'PDF document', '2026-08-31', '176 KB'],
  ['invoice-2026-09.pdf', 'PDF document', '2026-09-30', '191 KB'],
  ['tax-return-2025.pdf', 'PDF document', '2026-04-12', '1.2 MB'],
  ['budget-2026.xlsx', 'Spreadsheet', '2026-01-08', '84 KB'],
  ['expenses-q3.xlsx', 'Spreadsheet', '2026-10-02', '61 KB'],
  ['quarterly-report-q3.docx', 'Document', '2026-10-05', '412 KB'],
  ['meeting-notes-2026-10-14.md', 'Markdown', '2026-10-14', '6 KB'],
  ['meeting-notes-2026-10-07.md', 'Markdown', '2026-10-07', '5 KB'],
  ['roadmap-canvas-os.md', 'Markdown', '2026-09-21', '12 KB'],
  ['architecture-diagram.png', 'Image', '2026-09-18', '640 KB'],
  ['team-photo-offsite.jpg', 'Image', '2026-06-22', '3.4 MB'],
  ['screenshot-2026-10-16.png', 'Image', '2026-10-16', '1.1 MB'],
  ['passport-scan.pdf', 'PDF document', '2025-11-03', '2.0 MB'],
  ['lease-agreement.pdf', 'PDF document', '2025-08-15', '940 KB'],
  ['resume-2026.pdf', 'PDF document', '2026-03-01', '210 KB'],
  ['cover-letter.docx', 'Document', '2026-03-01', '38 KB'],
  ['recipes-pasta.txt', 'Text', '2026-02-11', '4 KB'],
  ['travel-itinerary-tokyo.pdf', 'PDF document', '2026-05-20', '330 KB'],
  ['flight-booking-tokyo.pdf', 'PDF document', '2026-05-18', '120 KB'],
  ['model-intent-v1.tflite', 'LiteRT model', '2026-10-10', '2.8 MB'],
  ['dataset-intents.csv', 'CSV data', '2026-10-09', '1.6 MB'],
  ['presentation-launch.pptx', 'Presentation', '2026-09-29', '5.2 MB'],
  ['contract-vendor-acme.pdf', 'PDF document', '2026-08-04', '510 KB'],
  ['notes-ideas.txt', 'Text', '2026-10-15', '3 KB'],
  ['photo-sunset-beach.jpg', 'Image', '2026-07-04', '2.7 MB'],
  ['podcast-episode-12.mp3', 'Audio', '2026-09-12', '48 MB'],
  ['backup-settings.json', 'JSON data', '2026-10-01', '9 KB'],
]

export const DEMO_FILES: readonly FileEntry[] = raw.map(([name, kind, modified, size], i) => ({
  id: `f${i + 1}`,
  name,
  kind,
  modified,
  size,
}))

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'my', 'me', 'for', 'of', 'to', 'in', 'on', 'and', 'or', 'all', 'show', 'find', 'search',
  'open', 'get', 'list', 'look', 'where', 'is', 'are', 'file', 'files', 'document', 'documents', 'please',
])
const MAX_RESULTS = 25

const stem = (token: string) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

export function createFileIndex(initial: readonly FileEntry[], { latencyMs = 250 } = {}) {
  let files = initial
  let ids = new Set(files.map((f) => f.id))
  return {
    replace(next: readonly FileEntry[]): void {
      files = next
      ids = new Set(next.map((f) => f.id))
    },
    has(id: string): boolean {
      return ids.has(id)
    },
    get size(): number {
      return files.length
    },
    async search(query: string, signal: AbortSignal): Promise<FileEntry[]> {
      await delay(latencyMs, signal)
      const tokens = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t && !STOP_WORDS.has(t))
        .map(stem)
      if (tokens.length === 0) return []
      return files
        .map((file) => {
          const haystack = `${file.name} ${file.kind} ${file.path ?? ''}`.toLowerCase()
          return { file, score: tokens.filter((t) => haystack.includes(t)).length }
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || b.file.modified.localeCompare(a.file.modified))
        .slice(0, MAX_RESULTS)
        .map(({ file }) => file)
    },
  }
}

export type FileIndex = ReturnType<typeof createFileIndex>
