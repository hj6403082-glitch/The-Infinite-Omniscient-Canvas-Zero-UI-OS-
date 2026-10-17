import { type InferenceLog, initInference } from '../inference/accelerator.ts'
import { InferenceSession } from '../inference/inference-session.ts'
import type { LiteRtPort } from '../inference/types.ts'
import { IntentLoop } from './intent-loop.ts'
import { parseWorkerCommand, type WorkerCommand, type WorkerEvent } from './protocol.ts'

export interface WorkerRuntimeDeps {
  port: LiteRtPort
  post(event: WorkerEvent): void
  log: InferenceLog
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Everything the intent worker does, minus the global `self` wiring (see intent.worker.ts).
export function createWorkerRuntime({ port, post, log }: WorkerRuntimeDeps) {
  let state: 'idle' | 'initializing' | 'ready' | 'stopped' = 'idle'
  let initializing: Promise<void> | undefined
  let session: InferenceSession | undefined
  let loop: IntentLoop | undefined
  let pendingText: string | null = null

  async function init({ wasmPath, modelUrl }: Extract<WorkerCommand, { type: 'init' }>): Promise<void> {
    let result
    try {
      result = await initInference(port, { wasmPath, modelUrl, log })
    } catch (error) {
      if (state === 'stopped') return
      state = 'idle'
      post({ type: 'error', message: `Inference init failed: ${message(error)}` })
      return
    }
    session = new InferenceSession(port, result.model)
    if (state === 'stopped') {
      session.dispose()
      return
    }
    loop = new IntentLoop({
      session,
      onIntent: (intent, query) => post({ type: 'intent', intent, query }),
      onError: (error) => post({ type: 'error', message: `Inference failed: ${message(error)}` }),
    })
    state = 'ready'
    post({ type: 'ready', accelerator: result.accelerator, attempts: result.attempts })
    if (pendingText !== null) loop.text(pendingText)
    pendingText = null
  }

  async function stop(): Promise<void> {
    const previous = state
    state = 'stopped'
    if (previous === 'initializing') await initializing
    await loop?.stop()
    post({ type: 'stopped', tensors: session?.ledger.stats ?? { created: 0, deleted: 0 } })
  }

  async function handle(data: unknown): Promise<void> {
    const command = parseWorkerCommand(data)
    if (!command) {
      post({ type: 'error', message: 'Rejected invalid worker command' })
      return
    }
    if (state === 'stopped') return
    switch (command.type) {
      case 'init':
        if (state !== 'idle') {
          post({ type: 'error', message: 'Inference already initialized' })
          return
        }
        state = 'initializing'
        initializing = init(command)
        return initializing
      case 'text':
        if (loop) loop.text(command.text)
        else pendingText = command.text
        return
      case 'pointer':
        loop?.pointer(command.x, command.y, command.at)
        return
      case 'stop':
        return stop()
    }
  }

  return { handle }
}
