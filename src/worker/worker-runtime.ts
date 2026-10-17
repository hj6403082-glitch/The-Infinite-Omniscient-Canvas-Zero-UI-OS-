import { type InferenceLog, initInference } from '../inference/accelerator.ts'
import { InferenceSession } from '../inference/inference-session.ts'
import type { AcceleratorTarget, LiteRtPort } from '../inference/types.ts'
import { createToolRegistry } from '../tools/registry.ts'
import { createTaskManager } from '../tools/task-manager.ts'
import type { ToolDefinition } from '../tools/types.ts'
import { IntentLoop } from './intent-loop.ts'
import { parseWorkerCommand, type WorkerCommand, type WorkerEvent } from './protocol.ts'

export interface WorkerRuntimeDeps {
  port: LiteRtPort
  post(event: WorkerEvent): void
  log: InferenceLog
  tools: readonly ToolDefinition[]
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Everything the intent worker does, minus the global `self` wiring (see intent.worker.ts).
export function createWorkerRuntime({ port, post, log, tools }: WorkerRuntimeDeps) {
  let state: 'idle' | 'initializing' | 'ready' | 'stopped' = 'idle'
  let initializing: Promise<void> | undefined
  let session: InferenceSession | undefined
  let loop: IntentLoop | undefined
  let accelerator: AcceleratorTarget | null = null
  let pendingText: string | null = null

  const tensorStats = () => session?.ledger.stats ?? { created: 0, deleted: 0 }

  // Tool-Call Render Pattern (CLAUDE.md §5): intents start tools that stream A2UI surfaces.
  const tasks = createTaskManager({
    registry: createToolRegistry(tools),
    emit: (messages) => post({ type: 'a2ui', messages }),
    status: () => ({ accelerator, tensors: tensorStats() }),
    onEnded: (ended) => post({ type: 'taskEnded', ...ended, tensors: tensorStats() }),
    onError: (surfaceId, error) => post({ type: 'error', message: `Tool ${surfaceId} failed: ${message(error)}` }),
  })

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
      onIntent: (intent, query) => {
        post({ type: 'intent', intent, query })
        tasks.start(intent.tool, query)
      },
      onError: (error) => post({ type: 'error', message: `Inference failed: ${message(error)}` }),
    })
    state = 'ready'
    accelerator = result.accelerator
    post({ type: 'ready', accelerator: result.accelerator, attempts: result.attempts })
    if (pendingText !== null) loop.text(pendingText)
    pendingText = null
  }

  async function stop(): Promise<void> {
    const previous = state
    state = 'stopped'
    if (previous === 'initializing') await initializing
    tasks.endAll()
    await loop?.stop()
    post({ type: 'stopped', tensors: tensorStats() })
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
      case 'action':
        tasks.action(command.surfaceId, command.name, command.context)
        return
      case 'dismiss':
        tasks.dismiss(command.surfaceId)
        return
      case 'stop':
        return stop()
    }
  }

  return { handle }
}
