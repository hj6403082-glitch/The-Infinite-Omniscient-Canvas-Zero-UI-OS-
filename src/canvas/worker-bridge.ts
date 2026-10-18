import { parseWorkerCommand, parseWorkerEvent, type WorkerCommand, type WorkerEvent } from '../worker/protocol.ts'

export interface WorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

// Main-thread end of the worker protocol: validates traffic in both directions.
export function createWorkerBridge(
  worker: WorkerLike,
  { onEvent, onInvalid }: { onEvent(event: WorkerEvent): void; onInvalid(data: unknown): void },
) {
  const listener = (event: MessageEvent<unknown>) => {
    const parsed = parseWorkerEvent(event.data)
    if (parsed) onEvent(parsed)
    else onInvalid(event.data)
  }
  worker.addEventListener('message', listener)

  return {
    send(command: WorkerCommand): void {
      const parsed = parseWorkerCommand(command)
      if (!parsed) throw new Error(`Refusing to send an invalid worker command: ${command.type}`)
      worker.postMessage(parsed)
    },
    dispose(): void {
      worker.postMessage({ type: 'stop' })
      worker.removeEventListener('message', listener)
      worker.terminate()
    },
  }
}

export type WorkerBridge = ReturnType<typeof createWorkerBridge>
