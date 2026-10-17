// Demo file index for the searchFiles tool. Replace with a real (OPFS / native) index later.

export interface FileEntry {
  id: string
  name: string
  kind: string
  modified: string
  size: string
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

export function createFileIndex(files: readonly FileEntry[], { latencyMs = 250 } = {}) {
  return {
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
          const haystack = `${file.name} ${file.kind}`.toLowerCase()
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
