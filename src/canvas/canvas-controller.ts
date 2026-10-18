import type { ReactCatalogComponent } from '@a2ui/react/v0_9'
import { type ActionPayload, MessageProcessor, STRICT_VALIDATION, type SurfaceModel } from '@a2ui/web_core/v0_9'
import { createFrameBatcher, type FrameScheduler } from '../a2ui/frame-batcher.ts'
import { createMessageGate } from '../a2ui/message-gate.ts'
import { trustedCatalog } from '../a2ui/trusted-catalog.ts'
import type { Intent } from '../inference/intent-decoder.ts'
import type { AcceleratorTarget } from '../inference/types.ts'
import { MAX_TEXT_LENGTH, type WorkerCommand, type WorkerEvent } from '../worker/protocol.ts'
import { createLocalFileStore, openLocalFile } from './local-files.ts'

const POINTER_INTERVAL_MS = 50
const MAX_NOTICES = 5
const MAX_CONTEXT_KEYS = 16
const MAX_CONTEXT_STRING = 1024

export type CanvasSurface = SurfaceModel<ReactCatalogComponent>

export interface CanvasSnapshot {
  phase: 'loading' | 'ready' | 'failed'
  accelerator: AcceleratorTarget | null
  fallbacks: string[]
  surfaces: CanvasSurface[]
  lastIntent: (Intent & { query: string }) | null
  tensors: { created: number; deleted: number }
  rejected: number
  notices: string[]
  // The connected folder; null while searching the demo files.
  files: { source: string; count: number } | null
}

export interface CanvasControllerOptions {
  send(command: WorkerCommand): void
  frames?: FrameScheduler
  now?: () => number
  openFile?: (file: File) => void
}

type Primitive = string | number | boolean | null

// Only flat JSON primitives cross back into the worker (matches the protocol schema).
function flatContext(context: Record<string, unknown>): Record<string, Primitive> {
  const out: Record<string, Primitive> = {}
  for (const [key, value] of Object.entries(context).slice(0, MAX_CONTEXT_KEYS)) {
    if (typeof value === 'string') out[key] = value.slice(0, MAX_CONTEXT_STRING)
    else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || value === null) {
      out[key] = value
    }
  }
  return out
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

// Main-thread state for the canvas: A2UI processor behind the zero-trust gate and the
// frame batcher, plus everything the chrome shows. React subscribes via useSyncExternalStore.
export function createCanvasController({
  send,
  frames,
  now = () => performance.now(),
  openFile = (file) => void openLocalFile(file),
}: CanvasControllerOptions) {
  const localFiles = createLocalFileStore()
  let snapshot: CanvasSnapshot = {
    phase: 'loading',
    accelerator: null,
    fallbacks: [],
    surfaces: [],
    lastIntent: null,
    tensors: { created: 0, deleted: 0 },
    rejected: 0,
    notices: [],
    files: null,
  }
  const listeners = new Set<() => void>()
  let lastPointerAt = Number.NEGATIVE_INFINITY

  function update(patch: Partial<CanvasSnapshot>): void {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  const notice = (message: string) => update({ notices: [...snapshot.notices, message].slice(-MAX_NOTICES) })

  const processor = new MessageProcessor<ReactCatalogComponent>(
    [trustedCatalog],
    (action: ActionPayload) => {
      send({ type: 'action', surfaceId: action.surfaceId, name: action.name, context: flatContext(action.context) })
    },
    { validationConfig: STRICT_VALIDATION },
  )
  const syncSurfaces = () => update({ surfaces: [...processor.getSurfaces().values()] })
  processor.onSurfaceCreated(syncSurfaces)
  processor.onSurfaceDeleted(syncSurfaces)

  const gate = createMessageGate(processor, {
    onReject: (reason) => {
      update({ rejected: snapshot.rejected + 1 })
      notice(`Blocked an unsafe UI update (${reason})`)
    },
  })
  const batcher = createFrameBatcher<unknown>((messages) => gate.apply(messages), frames)

  return {
    getSnapshot: (): CanvasSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    handleEvent(event: WorkerEvent): void {
      switch (event.type) {
        case 'ready':
          update({
            phase: 'ready',
            accelerator: event.accelerator,
            fallbacks: event.attempts.map((a) => `${a.target}: ${a.reason}`),
          })
          return
        case 'intent':
          update({ lastIntent: { ...event.intent, query: event.query }, tensors: event.tensors })
          return
        case 'a2ui':
          batcher.push(event.messages)
          return
        case 'taskEnded':
          update({ tensors: event.tensors })
          return
        case 'error':
          if (event.scope === 'init') update({ phase: 'failed' })
          notice(event.message)
          return
        case 'stopped':
          update({ tensors: event.tensors })
          return
        case 'filesIndexed':
          update({ files: { source: event.source, count: event.count } })
          return
        case 'openFile': {
          const file = localFiles.get(event.fileId)
          if (file) openFile(file)
          else notice('That is a demo file. Connect a folder to search and open your own files.')
          return
        }
      }
    },

    text(text: string): void {
      send({ type: 'text', text: text.slice(0, MAX_TEXT_LENGTH) })
    },

    pointer(x: number, y: number): void {
      const at = now()
      if (at - lastPointerAt < POINTER_INTERVAL_MS) return
      lastPointerAt = at
      send({ type: 'pointer', x: clamp01(x), y: clamp01(y), at: Math.max(0, at) })
    },

    connectFiles(selection: Iterable<File>): void {
      const payload = localFiles.connect(selection)
      if (!payload) {
        notice('No files found in that folder (hidden files are skipped).')
        return
      }
      send({ type: 'indexFiles', ...payload })
    },

    reportInvalidWorkerMessage(): void {
      notice('Ignored a malformed message from the inference worker')
    },

    dismiss(surfaceId: string): void {
      if (processor.getSurface(surfaceId)) send({ type: 'dismiss', surfaceId })
    },

    dispose(): void {
      batcher.dispose()
      processor.dispose()
      listeners.clear()
    },
  }
}

export type CanvasController = ReturnType<typeof createCanvasController>
